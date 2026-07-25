-- Multi-UOM: every product has a stock_unit (the atomic, most-granular unit stock is tracked and
-- adjusted in -- always integer quantities in this unit). purchase_unit and sale_unit are each
-- independently convertible to stock_unit via a single integer factor ("1 [purchase/sale] unit =
-- N stock units"). This flat model is mathematically equivalent to a chain (carton->packet->gram)
-- and much simpler to query than a recursive/chained conversion table. sale_unit is captured now
-- even though Phase 3's POS is what will consume it -- retrofitting this onto already-populated
-- products later is far more disruptive than shipping the column now.
--
-- tax_rate_bps is basis points out of 10,000 (1750 = 17.50%) -- a percentage is dimensionless,
-- not currency, so this deliberately does NOT reuse lib/money.ts's Paisa convention (see
-- lib/tax.ts).
--
-- current_stock is a denormalized projection maintained ONLY by the stock_ledger trigger (see
-- 20260725000015) -- never written directly. There is no client UPDATE policy on this table at
-- all (see 20260725000017_rls_policies_phase2.sql), so unlike users.pin_hash this needs no
-- separate column-privilege migration to protect it.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name_en text not null,
  name_ur text,
  category_id uuid references public.categories(id) on delete restrict,
  brand text,
  stock_unit_id uuid not null references public.units(id) on delete restrict,
  purchase_unit_id uuid references public.units(id) on delete restrict,
  purchase_to_stock_factor integer not null default 1 check (purchase_to_stock_factor >= 1),
  sale_unit_id uuid references public.units(id) on delete restrict,
  sale_to_stock_factor integer not null default 1 check (sale_to_stock_factor >= 1),
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 10000),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  current_stock integer not null default 0,
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_products_tenant_active on public.products (tenant_id, is_active);
create index idx_products_category on public.products (category_id);

alter table public.products enable row level security;

create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();
