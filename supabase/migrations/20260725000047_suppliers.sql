create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  phone text,
  address text,
  credit_terms_days integer check (credit_terms_days is null or credit_terms_days >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_suppliers_tenant_active on public.suppliers (tenant_id, is_active);

alter table public.suppliers enable row level security;

create trigger trg_suppliers_updated_at
before update on public.suppliers
for each row execute function public.set_updated_at();
