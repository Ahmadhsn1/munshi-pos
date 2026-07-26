-- A POOL payment "on account", NOT scoped to any specific sale -- unlike Phase 4's
-- purchase_payments (scoped to one purchase_id, a fixed invoice), a khata customer's payment
-- isn't naturally tied to one past sale; real udhaar registers just net it against the running
-- tab. This is the correct reading of plan.md's "partial payment allocation against balance" --
-- against the BALANCE, not a specific invoice.
create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  payment_mode text not null check (payment_mode in ('cash', 'bank_transfer', 'cheque', 'jazzcash', 'easypaisa')),
  amount_paisa integer not null check (amount_paisa > 0),
  reference_text text,
  paid_at date not null default current_date,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_customer_payments_tenant_customer on public.customer_payments (tenant_id, customer_id);

alter table public.customer_payments enable row level security;

create or replace function public.enforce_customer_payments_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_customer_tenant_id uuid;
  v_created_by_tenant_id uuid;
begin
  select tenant_id into v_customer_tenant_id from public.customers where id = new.customer_id;
  if v_customer_tenant_id is distinct from new.tenant_id then
    raise exception 'customer_payments.customer_id must belong to the same tenant';
  end if;

  select tenant_id into v_created_by_tenant_id from public.users where id = new.created_by;
  if v_created_by_tenant_id is distinct from new.tenant_id then
    raise exception 'customer_payments.created_by must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_customer_payments_tenant_consistency() from public;
revoke execute on function public.enforce_customer_payments_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_customer_payments_tenant_consistency
before insert on public.customer_payments
for each row execute function public.enforce_customer_payments_tenant_consistency();

create policy "customer_payments_select_own_tenant"
on public.customer_payments
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));
