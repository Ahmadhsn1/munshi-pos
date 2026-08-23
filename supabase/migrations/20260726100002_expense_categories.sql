-- Phase 6: expense categories. Tenant-scoped and fully editable, following the `units` precedent
-- (20260725000010) rather than a fixed check-constrained list -- the shop must be able to delete
-- the starter categories it doesn't use and add its own (a wholesaler's "labour"/"freight" and a
-- kiryana's "tea/food" are not the same list, and neither is knowable up front).
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  key text not null,
  name text not null,
  -- Soft "delete" only. A category cannot be hard-deleted once expenses reference it without
  -- either destroying financial history or silently re-labelling old expenses -- both violate
  -- absolute rule 4. Deactivating hides it from the entry form while every historical expense
  -- keeps its real category name in reports. The delete endpoint therefore flips this flag.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_expense_categories_tenant_key on public.expense_categories (tenant_id, lower(key));
create index idx_expense_categories_tenant_id on public.expense_categories (tenant_id);

alter table public.expense_categories enable row level security;

create trigger trg_expense_categories_updated_at
before update on public.expense_categories
for each row execute function public.set_updated_at();

create policy "expense_categories_select_own_tenant"
on public.expense_categories
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

-- Starter set for every EXISTING tenant. ENGINEERING.md notes that when default units were introduced,
-- pre-existing tenants were left with an empty catalog and had to hand-create their own -- that was
-- accepted then, but it is a bad first-run experience and trivially avoidable, so this migration
-- back-fills instead of repeating it. on conflict do nothing keeps it re-runnable.
insert into public.expense_categories (tenant_id, key, name)
select t.id, c.key, c.name
from public.tenants t
cross join (values
  ('rent', 'Rent'),
  ('utilities', 'Utilities (bijli/gas/paani)'),
  ('salaries', 'Salaries & wages'),
  ('transport', 'Transport & freight'),
  ('supplies', 'Shop supplies'),
  ('maintenance', 'Repairs & maintenance'),
  ('tea_food', 'Tea & food'),
  ('other', 'Other')
) as c(key, name)
on conflict do nothing;
