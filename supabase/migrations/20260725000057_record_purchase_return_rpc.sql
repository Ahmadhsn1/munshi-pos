-- Returns stock to a supplier against a purchase that has had at least one receipt. Deliberately
-- never touches products.avg_cost_paisa: if S units are held at average A (total value S*A) and k
-- units are removed at the current average (value removed k*A), the remaining (S-k) units are
-- still worth (S-k)*A -- the average is unchanged by construction. Touching it here would be the
-- bug, not a missing feature.
create or replace function public.record_purchase_return(
  p_tenant_id uuid,
  p_purchase_id uuid,
  p_reason_code text,
  p_note text,
  p_created_by uuid,
  p_lines jsonb -- [{purchase_line_item_id, quantity}] -- stock_unit terms
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_purchase record;
  v_return_id uuid;
  v_line jsonb;
  v_line_item record;
  v_requested_quantity integer;
  v_already_received_stock_units integer;
  v_already_returned_stock_units integer;
  v_remaining_returnable integer;
  v_current_stock integer;
begin
  select * into v_purchase from public.purchases where id = p_purchase_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'Purchase not found';
  end if;

  if v_purchase.status not in ('partially_received', 'received') then
    raise exception 'Can only return goods against a purchase with at least one receipt (status: %)', v_purchase.status;
  end if;

  insert into public.purchase_returns (tenant_id, purchase_id, reason_code, note, created_by)
  values (p_tenant_id, p_purchase_id, p_reason_code, p_note, p_created_by)
  returning id into v_return_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_line_item
      from public.purchase_line_items
      where id = (v_line ->> 'purchase_line_item_id')::uuid and purchase_id = p_purchase_id;

    if not found then
      raise exception 'Line item % does not belong to this purchase', v_line ->> 'purchase_line_item_id';
    end if;

    v_requested_quantity := (v_line ->> 'quantity')::integer;

    if v_requested_quantity <= 0 then
      raise exception 'Return quantity must be positive';
    end if;

    select coalesce(sum(quantity_received), 0) into v_already_received_stock_units
      from public.purchase_receipt_line_items
      where purchase_line_item_id = v_line_item.id;

    select coalesce(sum(quantity), 0) into v_already_returned_stock_units
      from public.purchase_return_line_items
      where purchase_line_item_id = v_line_item.id;

    v_remaining_returnable := v_already_received_stock_units - v_already_returned_stock_units;

    if v_requested_quantity > v_remaining_returnable then
      raise exception 'Cannot return % of product % -- only % remaining',
        v_requested_quantity, v_line_item.product_id, v_remaining_returnable;
    end if;

    -- Friendly pre-check: this purchase's own bookkeeping can pass while current_stock has
    -- already been depleted by an unrelated sale (current_stock is a single cross-source
    -- aggregate, no per-batch tracking) -- without this, the insert below would abort on the raw
    -- chk_products_current_stock_nonnegative constraint instead of a friendly, product-named error.
    select current_stock into v_current_stock from public.products where id = v_line_item.product_id for update;

    if v_current_stock < v_requested_quantity then
      raise exception 'Insufficient stock for product % to return: have %, need %',
        v_line_item.product_id, v_current_stock, v_requested_quantity;
    end if;

    insert into public.purchase_return_line_items (tenant_id, purchase_return_id, purchase_line_item_id, product_id, quantity)
    values (p_tenant_id, v_return_id, v_line_item.id, v_line_item.product_id, v_requested_quantity);

    insert into public.stock_ledger (tenant_id, product_id, movement_type, quantity_delta, purchase_return_id, created_by)
    values (p_tenant_id, v_line_item.product_id, 'purchase_return', -v_requested_quantity, v_return_id, p_created_by);
  end loop;

  return jsonb_build_object('purchaseReturnId', v_return_id);
end;
$$;

revoke execute on function public.record_purchase_return(uuid, uuid, text, text, uuid, jsonb) from public;
revoke execute on function public.record_purchase_return(uuid, uuid, text, text, uuid, jsonb) from anon, authenticated;
grant execute on function public.record_purchase_return(uuid, uuid, text, text, uuid, jsonb) to service_role;
