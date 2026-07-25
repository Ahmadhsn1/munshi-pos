-- A sale's lifecycle is entirely status-driven, not spread across tables: 'open' is a draft/held
-- cart (stock is untouched while open -- holding a bill must never reserve stock), 'completed' is
-- a finished, paid sale, 'void' is a completed sale that was fully reversed (see
-- record_sale_return_rpc.sql -- void is modeled as a full return, not a fourth status-adjacent
-- concept). Hold/recall needs no separate table: holding is simply not completing the row yet,
-- recalling is loading it + its lines back into the UI.
--
-- cashier_user_id/session_user_id: see the comment on shifts -- same effective-actor vs
-- real-session distinction, carried onto every sale for the same forensic-trail reason.
--
-- round_off_paisa is signed and only ever nonzero for a 100%-cash bill (never mixed with
-- khata/jazzcash/easypaisa) -- see lib/round-off.ts. invoice_number is assigned only at
-- completion (an 'open' draft has none), via sale_number_counters.
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  status text not null check (status in ('open', 'completed', 'void')) default 'open',
  invoice_number text,
  customer_id uuid references public.customers(id) on delete restrict,
  shift_id uuid not null references public.shifts(id) on delete restrict,
  cashier_user_id uuid not null references public.users(id) on delete restrict,
  session_user_id uuid not null references public.users(id) on delete restrict,
  held_label text,
  subtotal_paisa integer not null default 0 check (subtotal_paisa >= 0),
  line_discount_paisa integer not null default 0 check (line_discount_paisa >= 0),
  bill_discount_paisa integer not null default 0 check (bill_discount_paisa >= 0),
  tax_paisa integer not null default 0 check (tax_paisa >= 0),
  round_off_paisa integer not null default 0,
  total_paisa integer not null default 0 check (total_paisa >= 0),
  voided_at timestamptz,
  voided_by uuid references public.users(id) on delete restrict,
  void_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Unique only among assigned (non-null) invoice numbers -- every 'open' draft has none, so many
-- can coexist without colliding on this index.
create unique index uq_sales_tenant_invoice_number
  on public.sales (tenant_id, invoice_number)
  where invoice_number is not null;

create index idx_sales_tenant_status on public.sales (tenant_id, status);
create index idx_sales_tenant_shift on public.sales (tenant_id, shift_id);
create index idx_sales_tenant_customer on public.sales (tenant_id, customer_id) where customer_id is not null;

alter table public.sales enable row level security;
