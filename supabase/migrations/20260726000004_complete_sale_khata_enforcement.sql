-- Phase 5: khata credit-limit + blacklist enforcement, atomic with the checkout itself. A
-- check-then-write split across a Route Handler call and a separate RPC call can never be
-- atomic (no way to hold a lock across two network round-trips) -- so this has to live inside
-- complete_sale's own transaction, the same as every other money/stock guarantee in this
-- function.
--
-- Locking: right after the existing sale-row lock, and only when p_payments contains a
-- payment_mode='khata' entry, lock the customer row FOR UPDATE. This is the same row-lock idiom
-- already used for products below -- not a new primitive. A pg_advisory_xact_lock keyed by a
-- hash of the customer id was considered and rejected: advisory locks are instance-wide, not
-- tenant-scoped, so two different tenants' customers could collide on the same 32-bit hash key --
-- an unnecessary-contention footgun a plain row lock doesn't have. Lock ordering is safe (sale
-- row always locked first, nothing else locks a customer row in the opposite order).
--
-- Balance formula (computed fresh here, never stored):
--   balance = (khata sale_payments for this customer)
--           - (khata sale_return_payments for this customer, via sale_returns -> sales.customer_id)
--           - (customer_payments for this customer)
-- A voided khata sale nets to zero automatically: the void route already mirrors the original
-- sale's payments into sale_return_payments with the same payment_mode/amount_paisa before
-- calling record_sale_return.
--
-- Permission model: p_override_khata_limit is computed by the caller (Route Handler) from
-- context.permissions.has("customers.manage") -- the RPC doesn't know about the app's permission
-- system, so the authorization decision is passed in, mirroring how record_sale_return's
-- p_mark_sale_void works. Blacklisted-without-override or over-limit-without-override raises
-- (hard block); either condition true WITH override proceeds and sets khataWarning=true in the
-- return value for the checkout UI to surface as a warning toast.
--
-- Accepted, explicit gap: only this khata-limit check takes the customer row lock.
-- record_sale_return's khata-refund path and customer_payments inserts both only ever REDUCE
-- balance, so they can't cause a false negative here -- left unlocked, consistent with Phase 4's
-- purchase_payments having zero locking.
create or replace function public.complete_sale(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_bill_discount_paisa integer,
  p_round_off_paisa integer,
  p_payments jsonb,
  p_override_khata_limit boolean default false
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
  v_has_khata boolean := false;
  v_this_sale_khata integer := 0;
  v_customer_blacklisted boolean;
  v_customer_credit_limit integer;
  v_khata_debits integer;
  v_khata_credits_returns integer;
  v_khata_credits_payments integer;
  v_current_balance integer;
  v_khata_warning boolean := false;
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
    coalesce(bool_or(pay ->> 'payment_mode' = 'khata'), false),
    coalesce(sum(case when pay ->> 'payment_mode' = 'khata' then (pay ->> 'amount_paisa')::integer else 0 end), 0)
    into v_has_khata, v_this_sale_khata
    from jsonb_array_elements(p_payments) pay;

  if v_has_khata then
    if v_sale.customer_id is null then
      raise exception 'A khata payment requires the sale to have a customer';
    end if;

    perform 1 from public.customers where id = v_sale.customer_id and tenant_id = p_tenant_id for update;

    select is_blacklisted, credit_limit_paisa into v_customer_blacklisted, v_customer_credit_limit
      from public.customers where id = v_sale.customer_id;

    select coalesce(sum(sp.amount_paisa), 0) into v_khata_debits
      from public.sale_payments sp
      join public.sales s on s.id = sp.sale_id
      where s.customer_id = v_sale.customer_id and sp.payment_mode = 'khata';

    select coalesce(sum(srp.amount_paisa), 0) into v_khata_credits_returns
      from public.sale_return_payments srp
      join public.sale_returns sr on sr.id = srp.sale_return_id
      join public.sales s2 on s2.id = sr.sale_id
      where s2.customer_id = v_sale.customer_id and srp.payment_mode = 'khata';

    select coalesce(sum(amount_paisa), 0) into v_khata_credits_payments
      from public.customer_payments where customer_id = v_sale.customer_id;

    v_current_balance := v_khata_debits - v_khata_credits_returns - v_khata_credits_payments;

    if v_customer_blacklisted and not p_override_khata_limit then
      raise exception 'Customer is blacklisted from khata -- a manager override is required';
    end if;

    if v_customer_credit_limit is not null
       and (v_current_balance + v_this_sale_khata) > v_customer_credit_limit
       and not p_override_khata_limit
    then
      raise exception 'This sale would put the customer % paisa over their credit limit of % paisa',
        (v_current_balance + v_this_sale_khata) - v_customer_credit_limit, v_customer_credit_limit;
    end if;

    if p_override_khata_limit and (
      v_customer_blacklisted or
      (v_customer_credit_limit is not null and (v_current_balance + v_this_sale_khata) > v_customer_credit_limit)
    ) then
      v_khata_warning := true;
    end if;
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
    select current_stock, v_line.quantity * sale_to_stock_factor, avg_cost_paisa
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

  return jsonb_build_object(
    'saleId', p_sale_id,
    'invoiceNumber', v_invoice_number,
    'totalPaisa', v_total,
    'khataWarning', v_khata_warning
  );
end;
$$;
