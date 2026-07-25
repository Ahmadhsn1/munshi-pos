-- One row per tenant, atomically incremented inside complete_sale via an upsert to hand out
-- gapless-per-tenant invoice numbers without a table-wide lock.
create table public.sale_number_counters (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  next_number integer not null default 1
);

alter table public.sale_number_counters enable row level security;
