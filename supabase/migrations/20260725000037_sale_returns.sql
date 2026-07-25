-- Returns are a separate table family, not negative rows spliced into sale_line_items --
-- sale_line_items stays an immutable record of what was actually sold (Phase 6 needs sales and
-- returns as separate reportable facts), mirroring stock_ledger's append-only/compensating-entry
-- discipline one table up. "Void a completed sale" is modeled as a full return of every
-- not-yet-returned line (reason_code = 'void') plus sales.status='void' -- no third stock-movement
-- concept needed.
create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  return_number text,
  shift_id uuid not null references public.shifts(id) on delete restrict,
  cashier_user_id uuid not null references public.users(id) on delete restrict,
  session_user_id uuid not null references public.users(id) on delete restrict,
  reason_code text not null check (
    reason_code in ('defective', 'wrong_item', 'customer_changed_mind', 'void', 'other')
  ),
  note text,
  subtotal_paisa integer not null check (subtotal_paisa >= 0),
  tax_paisa integer not null default 0 check (tax_paisa >= 0),
  total_paisa integer not null check (total_paisa >= 0),
  created_at timestamptz not null default now()
);

create index idx_sale_returns_tenant_sale on public.sale_returns (tenant_id, sale_id);

alter table public.sale_returns enable row level security;
