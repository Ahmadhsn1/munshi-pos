-- Phase 6 forward-compat, done now while it's cheap: stamp products.avg_cost_paisa (read under
-- the lock the per-line loop already holds) onto the sale/sale_return stock_ledger rows'
-- existing-but-currently-unused unit_cost_paisa column. Without this, a future gross-margin
-- report would have no choice but to use TODAY's average cost against HISTORICAL sales -- silently
-- wrong the moment cost ever changes. Column and lock already exist; there is no way to
-- reconstruct a historical cost after the fact if this isn't done now.
create or replace function public.complete_sale(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_bill_discount_paisa integer,
  p_round_off_paisa integer,
  p_payments jsonb -- [{payment_mode, amount_paisa, reference_text}]
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sale record;
  v_line record;
  v_subtotal integer := 0;
  v_line_discount_total integer := 0;
  v_tax_total integer := 0;
  v_total integer;
  v_payment_sum integer := 0;
  v_payment jsonb;
  v_has_noncash boolean := false;
  v_current_stock integer;
  v_needed_stock integer;
  v_avg_cost_paisa integer;
  v_invoice_seq integer;
  v_invoice_number text;
begin
  select * into v_sale from public.sales where id = p_sale_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'Sale not found';
  end if;

  if v_sale.status <> 'open' then
    raise exception 'Sale is not open (status: %)', v_sale.status;
  end if;

  if not exists (select 1 from public.shifts where id = v_sale.shift_id and status = 'open') then
    raise exception 'Shift is not open';
  end if;

  select
    coalesce(sum(quantity * unit_price_paisa), 0),
    coalesce(sum(line_discount_paisa), 0),
    coalesce(sum(tax_paisa), 0)
  into v_subtotal, v_line_discount_total, v_tax_total
  from public.sale_line_items
  where sale_id = p_sale_id;

  if v_subtotal = 0 then
    raise exception 'Cannot complete a sale with no line items';
  end if;

  if p_bill_discount_paisa < 0 then
    raise exception 'Bill discount cannot be negative';
  end if;

  if abs(p_round_off_paisa) > 500 then
    raise exception 'Round-off out of the allowed range';
  end if;

  v_total := v_subtotal - v_line_discount_total - p_bill_discount_paisa + v_tax_total + p_round_off_paisa;

  if v_total < 0 then
    raise exception 'Computed total is negative -- check discounts';
  end if;

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    v_payment_sum := v_payment_sum + (v_payment ->> 'amount_paisa')::integer;
    if (v_payment ->> 'payment_mode') <> 'cash' then
      v_has_noncash := true;
    end if;
  end loop;

  if v_payment_sum <> v_total then
    raise exception 'Payments (%) do not sum to the total (%)', v_payment_sum, v_total;
  end if;

  if p_round_off_paisa <> 0 and v_has_noncash then
    raise exception 'Round-off can only be applied to a fully-cash sale';
  end if;

  for v_line in select * from public.sale_line_items where sale_id = p_sale_id
  loop
    select current_stock, quantity * sale_to_stock_factor, avg_cost_paisa
      into v_current_stock, v_needed_stock, v_avg_cost_paisa
      from public.products
      where id = v_line.product_id
      for update;

    if v_current_stock < v_needed_stock then
      raise exception 'Insufficient stock for product %: have %, need %',
        v_line.product_id, v_current_stock, v_needed_stock;
    end if;

    insert into public.stock_ledger (tenant_id, product_id, movement_type, quantity_delta, unit_cost_paisa, sale_id, created_by)
    values (p_tenant_id, v_line.product_id, 'sale', -v_needed_stock, v_avg_cost_paisa, p_sale_id, v_sale.cashier_user_id);
  end loop;

  insert into public.sale_number_counters (tenant_id, next_number)
  values (p_tenant_id, 2)
  on conflict (tenant_id) do update set next_number = sale_number_counters.next_number + 1
  returning next_number - 1 into v_invoice_seq;

  v_invoice_number := to_char(now(), 'YYYYMMDD') || '-' || lpad(v_invoice_seq::text, 5, '0');

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    insert into public.sale_payments (tenant_id, sale_id, payment_mode, amount_paisa, reference_text)
    values (
      p_tenant_id, p_sale_id, v_payment ->> 'payment_mode',
      (v_payment ->> 'amount_paisa')::integer, nullif(v_payment ->> 'reference_text', '')
    );
  end loop;

  update public.sales set
    status = 'completed',
    invoice_number = v_invoice_number,
    subtotal_paisa = v_subtotal,
    line_discount_paisa = v_line_discount_total,
    bill_discount_paisa = p_bill_discount_paisa,
    tax_paisa = v_tax_total,
    round_off_paisa = p_round_off_paisa,
    total_paisa = v_total,
    completed_at = now()
  where id = p_sale_id;

  return jsonb_build_object('saleId', p_sale_id, 'invoiceNumber', v_invoice_number, 'totalPaisa', v_total);
end;
$$;

-- Copies the ORIGINAL sale's cost snapshot (not today's average) onto the sale_return row, so COGS
-- reversal on a return matches what was actually booked at sale time.
create or replace function public.record_sale_return(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_shift_id uuid,
  p_cashier_user_id uuid,
  p_session_user_id uuid,
  p_reason_code text,
  p_note text,
  p_lines jsonb,             -- [{sale_line_item_id, quantity}]
  p_refund_payments jsonb,   -- [{payment_mode, amount_paisa, reference_text}]
  p_mark_sale_void boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sale record;
  v_line jsonb;
  v_original record;
  v_already_returned integer;
  v_remaining integer;
  v_return_quantity integer;
  v_line_tax integer;
  v_line_total integer;
  v_subtotal integer := 0;
  v_tax_total integer := 0;
  v_total integer;
  v_return_id uuid;
  v_return_seq integer;
  v_return_number text;
  v_payment jsonb;
  v_refund_sum integer := 0;
  v_stock_delta integer;
  v_original_unit_cost_paisa integer;
begin
  select * into v_sale from public.sales where id = p_sale_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'Sale not found';
  end if;

  if v_sale.status <> 'completed' then
    raise exception 'Can only return items from a completed sale (status: %)', v_sale.status;
  end if;

  insert into public.sale_returns (
    tenant_id, sale_id, shift_id, cashier_user_id, session_user_id,
    reason_code, note, subtotal_paisa, tax_paisa, total_paisa
  ) values (
    p_tenant_id, p_sale_id, p_shift_id, p_cashier_user_id, p_session_user_id,
    p_reason_code, p_note, 0, 0, 0
  )
  returning id into v_return_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_original
      from public.sale_line_items
      where id = (v_line ->> 'sale_line_item_id')::uuid and sale_id = p_sale_id;

    if not found then
      raise exception 'Line item % does not belong to this sale', v_line ->> 'sale_line_item_id';
    end if;

    select coalesce(sum(quantity), 0) into v_already_returned
      from public.sale_return_line_items
      where sale_line_item_id = v_original.id;

    v_remaining := v_original.quantity - v_already_returned;
    v_return_quantity := (v_line ->> 'quantity')::integer;

    if v_return_quantity > v_remaining then
      raise exception 'Cannot return % of product % -- only % remaining',
        v_return_quantity, v_original.product_id, v_remaining;
    end if;

    v_line_tax := round(v_original.tax_paisa::numeric * v_return_quantity / v_original.quantity);
    v_line_total := v_original.unit_price_paisa * v_return_quantity + v_line_tax;

    insert into public.sale_return_line_items (
      tenant_id, sale_return_id, sale_line_item_id, product_id,
      quantity, unit_price_paisa, tax_paisa, line_total_paisa
    ) values (
      p_tenant_id, v_return_id, v_original.id, v_original.product_id,
      v_return_quantity, v_original.unit_price_paisa, v_line_tax, v_line_total
    );

    v_subtotal := v_subtotal + v_original.unit_price_paisa * v_return_quantity;
    v_tax_total := v_tax_total + v_line_tax;

    select v_return_quantity * sale_to_stock_factor into v_stock_delta
      from public.products where id = v_original.product_id;

    select unit_cost_paisa into v_original_unit_cost_paisa
      from public.stock_ledger
      where sale_id = p_sale_id and product_id = v_original.product_id and movement_type = 'sale'
      limit 1;

    insert into public.stock_ledger (
      tenant_id, product_id, movement_type, quantity_delta, unit_cost_paisa, sale_return_id, created_by
    ) values (
      p_tenant_id, v_original.product_id, 'sale_return', v_stock_delta, v_original_unit_cost_paisa, v_return_id, p_cashier_user_id
    );
  end loop;

  v_total := v_subtotal + v_tax_total;

  for v_payment in select * from jsonb_array_elements(p_refund_payments)
  loop
    v_refund_sum := v_refund_sum + (v_payment ->> 'amount_paisa')::integer;

    insert into public.sale_return_payments (tenant_id, sale_return_id, payment_mode, amount_paisa, reference_text)
    values (
      p_tenant_id, v_return_id, v_payment ->> 'payment_mode',
      (v_payment ->> 'amount_paisa')::integer, nullif(v_payment ->> 'reference_text', '')
    );
  end loop;

  if v_refund_sum <> v_total then
    raise exception 'Refund payments (%) do not sum to the return total (%)', v_refund_sum, v_total;
  end if;

  insert into public.sale_number_counters (tenant_id, next_number)
  values (p_tenant_id, 2)
  on conflict (tenant_id) do update set next_number = sale_number_counters.next_number + 1
  returning next_number - 1 into v_return_seq;

  v_return_number := 'RET-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_return_seq::text, 5, '0');

  update public.sale_returns
    set subtotal_paisa = v_subtotal, tax_paisa = v_tax_total, total_paisa = v_total, return_number = v_return_number
    where id = v_return_id;

  if p_mark_sale_void then
    update public.sales
      set status = 'void', voided_at = now(), voided_by = p_cashier_user_id, void_reason = p_reason_code
      where id = p_sale_id;
  end if;

  return jsonb_build_object('saleReturnId', v_return_id, 'returnNumber', v_return_number, 'totalPaisa', v_total);
end;
$$;
