-- Tenant-scoped, deliberately NOT a global catalog like roles/permissions: Pakistani kiryana/
-- wholesale shops routinely use informal units (bori, theli, gross) alongside kg/piece/carton,
-- so each tenant gets its own extensible catalog rather than a fixed global list. Every new
-- tenant is seeded with a starter set inside bootstrap_tenant (see
-- 20260725000015_bootstrap_tenant_default_units.sql).
create table public.units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  key text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_units_tenant_key on public.units (tenant_id, lower(key));
create index idx_units_tenant_id on public.units (tenant_id);

alter table public.units enable row level security;

create trigger trg_units_updated_at
before update on public.units
for each row execute function public.set_updated_at();
