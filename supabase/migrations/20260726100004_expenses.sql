-- Phase 6: shop expense entry -- the "cash out" half of the cash book. Without it the daily closing
-- summary can only ever show cash IN (sales + khata receipts) and would overstate what the owner
-- should actually find in the drawer.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  amount_paisa integer not null check (amount_paisa > 0),
  payment_mode text not null check (payment_mode in ('cash', 'bank_transfer', 'cheque', 'jazzcash', 'easypaisa')),
  note text,
  -- Same Asia/Karachi default as customer_payments/purchase_payments (migration ...0007) -- a
  -- late-night expense must not land on yesterday's cash book.
  expense_date date not null default (now() at time zone 'Asia/Karachi')::date,

  -- Set ONLY when the money physically left the counter drawer, which is what makes it part of
  -- that shift's expected-cash reconciliation. Nullable on purpose: an owner paying rent by bank
  -- transfer, or handing over cash from the office safe rather than the till, is a real expense
  -- that must NOT move the cashier's drawer variance. The entry form therefore asks explicitly
  -- ("paid from counter cash?") instead of inferring it.
  shift_id uuid references public.shifts(id) on delete restrict,

  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),

  -- Absolute rule 4: no hard deletes on financial records. Mirrors the void columns already on
  -- public.sales rather than inventing a second soft-delete shape.
  voided_at timestamptz,
  voided_by uuid references public.users(id) on delete restrict,
  void_reason text,

  constraint expenses_void_fields_consistent check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null)
  ),
  -- Only cash can come out of a cash drawer. Without this a bank transfer could be attributed to a
  -- shift and would wrongly depress that cashier's expected cash.
  constraint expenses_shift_requires_cash check (shift_id is null or payment_mode = 'cash')
);

-- Matches the cash book's query shape: this tenant's live expenses over a date range.
create index idx_expenses_tenant_date on public.expenses (tenant_id, expense_date) where voided_at is null;
-- Backs shift-close expected-cash: live cash expenses for one shift.
create index idx_expenses_shift on public.expenses (shift_id) where voided_at is null and shift_id is not null;
create index idx_expenses_category_id on public.expenses (category_id);
create index idx_expenses_created_by on public.expenses (created_by);
create index idx_expenses_voided_by on public.expenses (voided_by);

alter table public.expenses enable row level security;

create or replace function public.enforce_expenses_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category_tenant_id uuid;
  v_shift_tenant_id uuid;
  v_created_by_tenant_id uuid;
  v_voided_by_tenant_id uuid;
begin
  select tenant_id into v_category_tenant_id from public.expense_categories where id = new.category_id;
  if v_category_tenant_id is distinct from new.tenant_id then
    raise exception 'expenses.category_id must belong to the same tenant';
  end if;

  if new.shift_id is not null then
    select tenant_id into v_shift_tenant_id from public.shifts where id = new.shift_id;
    if v_shift_tenant_id is distinct from new.tenant_id then
      raise exception 'expenses.shift_id must belong to the same tenant';
    end if;
  end if;

  select tenant_id into v_created_by_tenant_id from public.users where id = new.created_by;
  if v_created_by_tenant_id is distinct from new.tenant_id then
    raise exception 'expenses.created_by must belong to the same tenant';
  end if;

  if new.voided_by is not null then
    select tenant_id into v_voided_by_tenant_id from public.users where id = new.voided_by;
    if v_voided_by_tenant_id is distinct from new.tenant_id then
      raise exception 'expenses.voided_by must belong to the same tenant';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_expenses_tenant_consistency() from public;
revoke execute on function public.enforce_expenses_tenant_consistency() from anon, authenticated;

-- BEFORE UPDATE as well as INSERT, unlike the Phase 2/5 tenant-consistency triggers: those guard
-- insert-only tables, but an expense is voided via UPDATE, which is exactly when voided_by is set
-- and therefore exactly when it needs checking.
create trigger trg_enforce_expenses_tenant_consistency
before insert or update on public.expenses
for each row execute function public.enforce_expenses_tenant_consistency();

create policy "expenses_select_own_tenant"
on public.expenses
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));
