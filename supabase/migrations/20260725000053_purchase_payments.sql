create table public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  payment_mode text not null check (payment_mode in ('cash', 'bank_transfer', 'cheque', 'jazzcash', 'easypaisa')),
  amount_paisa integer not null check (amount_paisa > 0),
  reference_text text,
  paid_at date not null default current_date,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_purchase_payments_tenant_purchase on public.purchase_payments (tenant_id, purchase_id);

alter table public.purchase_payments enable row level security;

create or replace function public.enforce_purchase_payments_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_purchase_tenant_id uuid;
  v_created_by_tenant_id uuid;
begin
  select tenant_id into v_purchase_tenant_id from public.purchases where id = new.purchase_id;
  if v_purchase_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_payments.purchase_id must belong to the same tenant';
  end if;

  select tenant_id into v_created_by_tenant_id from public.users where id = new.created_by;
  if v_created_by_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_payments.created_by must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_purchase_payments_tenant_consistency() from public;
revoke execute on function public.enforce_purchase_payments_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_purchase_payments_tenant_consistency
before insert on public.purchase_payments
for each row execute function public.enforce_purchase_payments_tenant_consistency();
