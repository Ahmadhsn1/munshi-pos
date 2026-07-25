-- Minimal khata primitive for Phase 3. Full khata management (running balance, credit limit,
-- aging report, WhatsApp reminders, blacklist) is Phase 5's territory -- deliberately not built
-- here. This table exists now only because Phase 3's checkout needs "khata" to be a meaningful
-- payment mode, and Phase 5's own plan text ("credit limit enforcement at checkout") presupposes
-- this plumbing already exists. A customer's outstanding balance is fully derivable later from
-- sale_payments/sale_return_payments rows with payment_mode='khata' -- no running-balance column
-- needed yet.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_customers_tenant_phone
  on public.customers (tenant_id, phone)
  where phone is not null and phone <> '';
create index idx_customers_tenant_active on public.customers (tenant_id, is_active);

alter table public.customers enable row level security;

create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();
