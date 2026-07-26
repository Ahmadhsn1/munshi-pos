-- Closes a real gap: sale_payments already rejects a khata payment with no customer
-- (enforce_sale_payments_checks), but sale_return_payments never got the equivalent check.
-- Without it, a khata refund could be recorded against a sale that has no customer_id, creating
-- a khata credit that's unattributable to any customer in Phase 5's per-sale-netting aging model.
-- Extends the existing tenant-consistency function in place (CREATE OR REPLACE), matching how
-- enforce_sale_payments_checks itself combines both concerns in one function rather than adding a
-- second trigger that would re-derive the same tenant lookup.
create or replace function public.enforce_sale_return_payments_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_return_tenant_id uuid;
  v_customer_id uuid;
begin
  select sr.tenant_id, s.customer_id
    into v_return_tenant_id, v_customer_id
    from public.sale_returns sr
    join public.sales s on s.id = sr.sale_id
    where sr.id = new.sale_return_id;

  if v_return_tenant_id is distinct from new.tenant_id then
    raise exception 'sale_return_payments.tenant_id must match the sale_return''s tenant';
  end if;

  if new.payment_mode = 'khata' and v_customer_id is null then
    raise exception 'A khata refund requires the original sale to have a customer';
  end if;

  return new;
end;
$$;
