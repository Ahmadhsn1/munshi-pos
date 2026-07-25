-- Two checks in one BEFORE INSERT trigger:
--   1. Standard tenant-consistency defense-in-depth.
--   2. A 'khata' payment requires the parent sale to have a customer_id -- there's no one to owe
--      the money to otherwise. This is a DB backstop matching stock_ledger's existing
--      chk_adjustment_needs_reason precedent (an app rule enforced as a CHECK/trigger because the
--      admin client bypasses RLS): sale_payments is only ever written from complete_sale, so this
--      guards against a future bug in that one RPC, not a multi-writer concern.
create or replace function public.enforce_sale_payments_checks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sale_tenant_id uuid;
  v_customer_id uuid;
begin
  select tenant_id, customer_id into v_sale_tenant_id, v_customer_id
    from public.sales where id = new.sale_id;

  if v_sale_tenant_id is distinct from new.tenant_id then
    raise exception 'sale_payments.tenant_id must match the sale''s tenant';
  end if;

  if new.payment_mode = 'khata' and v_customer_id is null then
    raise exception 'A khata payment requires the sale to have a customer';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_sale_payments_checks() from public;
revoke execute on function public.enforce_sale_payments_checks() from anon, authenticated;

create trigger trg_enforce_sale_payments_checks
before insert on public.sale_payments
for each row execute function public.enforce_sale_payments_checks();
