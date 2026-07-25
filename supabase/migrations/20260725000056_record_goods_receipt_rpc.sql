-- The costing engine. Called once per physical delivery against a confirmed purchase (partial
-- receipt supported -- multiple calls against the same purchase are expected). This is the one
-- place in the app where incoming stock gets costed: applies the weighted-average formula using
-- the TOTAL paisa cost of the incoming batch (not a pre-rounded per-unit figure), rounding only
-- once at the very end, mirroring complete_sale's "recompute from stored rows, round once"
-- discipline. Every division feeding a round() gets an explicit ::numeric cast -- integer/integer
-- truncates silently before round() ever sees a fraction (record_sale_return's tax-proration line
-- already relies on this same cast).
--
-- Locking: the purchase header is locked FOR UPDATE first, exactly mirroring complete_sale's
-- opening line -- this is what actually serializes two concurrent receiving calls against the
-- SAME purchase (the over-receipt check reads purchase_receipt_line_items, a different table than
-- whatever a product-row lock alone would cover). Each product row is locked FOR UPDATE inside the
-- per-line loop, mirroring complete_sale's per-line stock pre-check, and additionally handles two
-- lines in one receipt referencing the same product correctly (each iteration sees its own prior
-- iteration's write within the same transaction).
create or replace function public.record_goods_receipt(
  p_tenant_id uuid,
  p_purchase_id uuid,
  p_received_by uuid,
  p_note text,
  p_lines jsonb -- [{purchase_line_item_id, quantity_received_purchase_units}]
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_purchase record;
  v_receipt_id uuid;
  v_line jsonb;
  v_line_item record;
  v_requested_purchase_units integer;
  v_requested_stock_units integer;
  v_invoiced_stock_units integer;
  v_already_received_stock_units integer;
  v_remaining_stock_units integer;
  v_receipt_discount_paisa integer;
  v_incoming_total_cost_paisa integer;
  v_unit_cost_net_paisa integer;
  v_current_stock integer;
  v_current_avg_cost_paisa integer;
  v_new_avg_cost_paisa integer;
  v_total_invoiced_stock_units integer;
  v_total_received_stock_units integer;
begin
  select * into v_purchase from public.purchases where id = p_purchase_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'Purchase not found';
  end if;

  if v_purchase.status not in ('confirmed', 'partially_received') then
    raise exception 'Purchase is not receivable (status: %)', v_purchase.status;
  end if;

  insert into public.purchase_receipts (tenant_id, purchase_id, received_by, note)
  values (p_tenant_id, p_purchase_id, p_received_by, p_note)
  returning id into v_receipt_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select pli.*, p.purchase_to_stock_factor as purchase_to_stock_factor
      into v_line_item
      from public.purchase_line_items pli
      join public.products p on p.id = pli.product_id
      where pli.id = (v_line ->> 'purchase_line_item_id')::uuid
        and pli.purchase_id = p_purchase_id;

    if not found then
      raise exception 'Line item % does not belong to this purchase', v_line ->> 'purchase_line_item_id';
    end if;

    v_requested_purchase_units := (v_line ->> 'quantity_received_purchase_units')::integer;

    if v_requested_purchase_units <= 0 then
      raise exception 'Quantity received must be positive';
    end if;

    -- Convert to stock units BEFORE comparing against the stock-unit-denominated already-received
    -- sum -- comparing purchase-unit invoiced quantity directly against a stock-unit sum silently
    -- breaks for any product with purchase_to_stock_factor <> 1 (e.g. cartons of 20).
    v_requested_stock_units := v_requested_purchase_units * v_line_item.purchase_to_stock_factor;
    v_invoiced_stock_units := v_line_item.quantity * v_line_item.purchase_to_stock_factor;

    select coalesce(sum(quantity_received), 0) into v_already_received_stock_units
      from public.purchase_receipt_line_items
      where purchase_line_item_id = v_line_item.id;

    v_remaining_stock_units := v_invoiced_stock_units - v_already_received_stock_units;

    if v_requested_stock_units > v_remaining_stock_units then
      raise exception 'Cannot receive % stock units of product % -- only % remaining',
        v_requested_stock_units, v_line_item.product_id, v_remaining_stock_units;
    end if;

    -- Discount is set at the invoice-line level for the WHOLE invoiced quantity; prorate it by
    -- this receipt's share of that quantity, same prorating pattern as record_sale_return's tax
    -- proration on partial returns.
    v_receipt_discount_paisa := round(
      v_line_item.discount_paisa::numeric * v_requested_purchase_units / v_line_item.quantity
    );
    v_incoming_total_cost_paisa := v_line_item.unit_cost_paisa * v_requested_purchase_units - v_receipt_discount_paisa;
    v_unit_cost_net_paisa := round(v_incoming_total_cost_paisa::numeric / v_requested_stock_units);

    select current_stock, avg_cost_paisa into v_current_stock, v_current_avg_cost_paisa
      from public.products where id = v_line_item.product_id for update;

    v_new_avg_cost_paisa := round(
      (v_current_stock::numeric * v_current_avg_cost_paisa + v_incoming_total_cost_paisa)
      / (v_current_stock + v_requested_stock_units)
    );

    update public.products set avg_cost_paisa = v_new_avg_cost_paisa where id = v_line_item.product_id;

    insert into public.stock_ledger (tenant_id, product_id, movement_type, quantity_delta, unit_cost_paisa, purchase_id, created_by)
    values (p_tenant_id, v_line_item.product_id, 'purchase', v_requested_stock_units, v_unit_cost_net_paisa, p_purchase_id, p_received_by);

    insert into public.purchase_receipt_line_items (tenant_id, purchase_receipt_id, purchase_line_item_id, product_id, quantity_received, unit_cost_net_paisa)
    values (p_tenant_id, v_receipt_id, v_line_item.id, v_line_item.product_id, v_requested_stock_units, v_unit_cost_net_paisa);
  end loop;

  select coalesce(sum(pli.quantity * p.purchase_to_stock_factor), 0)
    into v_total_invoiced_stock_units
    from public.purchase_line_items pli
    join public.products p on p.id = pli.product_id
    where pli.purchase_id = p_purchase_id;

  select coalesce(sum(prli.quantity_received), 0)
    into v_total_received_stock_units
    from public.purchase_receipt_line_items prli
    join public.purchase_line_items pli on pli.id = prli.purchase_line_item_id
    where pli.purchase_id = p_purchase_id;

  update public.purchases
    set status = case when v_total_received_stock_units >= v_total_invoiced_stock_units then 'received' else 'partially_received' end
    where id = p_purchase_id;

  return jsonb_build_object('purchaseReceiptId', v_receipt_id);
end;
$$;

revoke execute on function public.record_goods_receipt(uuid, uuid, uuid, text, jsonb) from public;
revoke execute on function public.record_goods_receipt(uuid, uuid, uuid, text, jsonb) from anon, authenticated;
grant execute on function public.record_goods_receipt(uuid, uuid, uuid, text, jsonb) to service_role;
