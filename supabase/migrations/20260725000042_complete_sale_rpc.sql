-- The checkout event. Called once a cashier presses "pay" on an already-built 'open' sale (cart
-- building itself is plain sequential admin-client calls -- no stored function needed there,
-- since a partial cart-edit failure has no financial/stock consequence). This is the one place
-- in the app where a client-controlled number directly moves money, so totals are recomputed
-- from the already-stored sale_line_items here, never trusted from the request.
--
-- Not wrapped in per-line savepoints (unlike import_opening_stock) -- a checkout is all-or-
-- nothing; one line failing (e.g. insufficient stock) must abort the entire sale, not silently
-- sell the rest of the cart.
--
-- Concurrency: `select ... for update` on both the sale row and each product row (inside the
-- per-line loop) takes real row locks. Two cashiers racing to sell the last unit of the same
-- product serialize at the product row lock -- the second transaction re-reads the fresh
-- current_stock after the first commits, and correctly fails the insufficient-stock check rather
-- than allowing stock to go negative. The `chk_products_current_stock_nonnegative` CHECK
-- constraint is the actual safety net; this pre-check just gives a friendly, product-named error
-- instead of a raw constraint-violation message.
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

  -- Bounded server-side so a tampered request can't smuggle a large discount through this field.
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

  -- Round-off must never desync a khata/digital debt from the exact paisa amount owed.
  if p_round_off_paisa <> 0 and v_has_noncash then
    raise exception 'Round-off can only be applied to a fully-cash sale';
  end if;

  for v_line in select * from public.sale_line_items where sale_id = p_sale_id
  loop
    select current_stock, quantity * sale_to_stock_factor
      into v_current_stock, v_needed_stock
      from public.products
      where id = v_line.product_id
      for update;

    if v_current_stock < v_needed_stock then
      raise exception 'Insufficient stock for product %: have %, need %',
        v_line.product_id, v_current_stock, v_needed_stock;
    end if;

    insert into public.stock_ledger (tenant_id, product_id, movement_type, quantity_delta, sale_id, created_by)
    values (p_tenant_id, v_line.product_id, 'sale', -v_needed_stock, p_sale_id, v_sale.cashier_user_id);
  end loop;

  insert into public.sale_number_counters (tenant_id, next_number)
  values (p_tenant_id, 2)
  on conflict (tenant_id) do update set next_number = sale_number_counters.next_number + 1
  returning next_number - 1 into v_invoice_seq;

  v_invoice_number := to_char(now(), 'YYYYMMDD') || '-' || lpad(v_invoice_seq::text, 5, '0');

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    -- The khata-requires-customer rule is enforced by enforce_sale_payments_checks() on this
    -- insert -- not duplicated here.
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

-- service_role only, same lockdown pattern as import_opening_stock/bootstrap_tenant.
revoke execute on function public.complete_sale(uuid, uuid, integer, integer, jsonb) from public;
revoke execute on function public.complete_sale(uuid, uuid, integer, integer, jsonb) from anon, authenticated;
grant execute on function public.complete_sale(uuid, uuid, integer, integer, jsonb) to service_role;
