-- Append-only source of truth for all stock movement. No UPDATE/DELETE, ever -- corrections are
-- compensating entries, standard accounting-ledger discipline. This can't be enforced against
-- service_role at the DB level (service_role bypasses RLS/grants by design), so it's an
-- app-code/reviewer discipline rule, same category as "never trust a client-supplied tenantId."
--
-- movement_type/reason_code are text + CHECK, deliberately not native Postgres enums -- extending
-- a CHECK later (Phase 3/4 adding sale/purchase/return) is a trivial additive migration; native
-- enums have real transaction-visibility footguns on ALTER TYPE ... ADD VALUE.
--
-- No generic reference_type/reference_id polymorphic column (no real FK integrity) -- Phase 3/4
-- will add proper nullable FK columns (sale_id, purchase_id) once those tables exist.
--
-- No current_stock >= 0 constraint anywhere in this schema -- a manager correcting bad historical
-- data during onboarding shouldn't be DB-blocked; negative-stock prevention on a *sale* is a
-- Phase 3 POS concern.
create table public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening_stock', 'adjustment')),
  quantity_delta integer not null check (quantity_delta <> 0),
  reason_code text check (reason_code in ('damage', 'theft', 'wastage', 'recount', 'other')),
  note text,
  unit_cost_paisa integer check (unit_cost_paisa is null or unit_cost_paisa >= 0),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint chk_adjustment_needs_reason
    check (movement_type <> 'adjustment' or reason_code is not null)
);

-- Enforces "opening stock happens once per product" -- a one-time onboarding event; later
-- corrections go through the normal adjustment flow. Also makes CSV re-upload safe: an
-- already-opening-stocked product is reported as "skipped," not double-counted.
create unique index uq_stock_ledger_opening_stock_once
  on public.stock_ledger (product_id)
  where movement_type = 'opening_stock';

create index idx_stock_ledger_tenant_product_created
  on public.stock_ledger (tenant_id, product_id, created_at desc);
create index idx_stock_ledger_tenant_created
  on public.stock_ledger (tenant_id, created_at desc);

alter table public.stock_ledger enable row level security;
