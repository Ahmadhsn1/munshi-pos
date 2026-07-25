-- No formal return-number sequence -- this is an internal record against a supplier, not a
-- customer-facing document like sale_returns' RET-prefixed numbers.
create table public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  reason_code text not null check (reason_code in ('damaged', 'wrong_item', 'expired', 'other')),
  note text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_purchase_returns_tenant_purchase on public.purchase_returns (tenant_id, purchase_id);

alter table public.purchase_returns enable row level security;

create or replace function public.enforce_purchase_returns_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_purchase_tenant_id uuid;
  v_created_by_tenant_id uuid;
begin
  select tenant_id into v_purchase_tenant_id from public.purchases where id = new.purchase_id;
  if v_purchase_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_returns.purchase_id must belong to the same tenant';
  end if;

  select tenant_id into v_created_by_tenant_id from public.users where id = new.created_by;
  if v_created_by_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_returns.created_by must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_purchase_returns_tenant_consistency() from public;
revoke execute on function public.enforce_purchase_returns_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_purchase_returns_tenant_consistency
before insert on public.purchase_returns
for each row execute function public.enforce_purchase_returns_tenant_consistency();

create table public.purchase_return_line_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  purchase_return_id uuid not null references public.purchase_returns(id) on delete restrict,
  purchase_line_item_id uuid not null references public.purchase_line_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  note text
);

create index idx_purchase_return_line_items_tenant_return on public.purchase_return_line_items (tenant_id, purchase_return_id);
create index idx_purchase_return_line_items_purchase_line_item on public.purchase_return_line_items (purchase_line_item_id);

alter table public.purchase_return_line_items enable row level security;

create or replace function public.enforce_purchase_return_line_items_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_return_tenant_id uuid;
  v_line_item_tenant_id uuid;
  v_product_tenant_id uuid;
begin
  select tenant_id into v_return_tenant_id from public.purchase_returns where id = new.purchase_return_id;
  if v_return_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_return_line_items.purchase_return_id must belong to the same tenant';
  end if;

  select tenant_id into v_line_item_tenant_id from public.purchase_line_items where id = new.purchase_line_item_id;
  if v_line_item_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_return_line_items.purchase_line_item_id must belong to the same tenant';
  end if;

  select tenant_id into v_product_tenant_id from public.products where id = new.product_id;
  if v_product_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_return_line_items.product_id must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_purchase_return_line_items_tenant_consistency() from public;
revoke execute on function public.enforce_purchase_return_line_items_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_purchase_return_line_items_tenant_consistency
before insert on public.purchase_return_line_items
for each row execute function public.enforce_purchase_return_line_items_tenant_consistency();
