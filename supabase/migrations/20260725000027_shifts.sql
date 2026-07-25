-- cashier_user_id is the effective actor (resolved via getActingUserContext -- the PIN
-- counter-login identity when present); session_user_id is whoever the real Supabase Auth
-- session belongs to (an owner/manager, possibly ringing up sales directly with no cashier
-- counter-login active). These collapse to the same value in that direct case, but keeping both
-- gives a forensic trail: "whose browser session this ran under" vs "who was actually at the
-- counter." See src/lib/permissions.ts#getActingUserContext.
--
-- expected_cash_paisa/actual_cash_paisa/variance_paisa are computed once, at close time, as a
-- query over the shift's cash sale_payments/sale_return_payments -- deliberately NOT an
-- incrementally-maintained trigger like products.current_stock. current_stock earns its trigger
-- because it's read on every product list (a hot path); shift variance is read ~once per shift
-- close, and a small shop's per-shift volume makes the aggregate trivially fast -- not worth
-- three write paths (sale, return, void) staying transactionally perfect for a value read once.
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  cashier_user_id uuid not null references public.users(id) on delete restrict,
  session_user_id uuid not null references public.users(id) on delete restrict,
  status text not null check (status in ('open', 'closed')) default 'open',
  opening_cash_paisa integer not null check (opening_cash_paisa >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  expected_cash_paisa integer,
  actual_cash_paisa integer,
  variance_paisa integer, -- signed: actual - expected
  closing_note text,
  created_by uuid not null references public.users(id) on delete restrict
);

-- One open shift per cashier at a time. Same idiom as Phase 2's
-- uq_stock_ledger_opening_stock_once (partial unique index enforcing a single-active-row
-- invariant). This also makes open_shift's "you already have an open shift" case a clean,
-- friendly unique_violation instead of needing a stored function.
create unique index uq_shifts_one_open_per_cashier
  on public.shifts (tenant_id, cashier_user_id)
  where status = 'open';

create index idx_shifts_tenant_status on public.shifts (tenant_id, status);

alter table public.shifts enable row level security;
