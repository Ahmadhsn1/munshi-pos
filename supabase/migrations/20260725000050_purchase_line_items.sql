-- quantity is in PURCHASE_UNIT terms (matches sale_line_items being in sale_unit terms) --
-- pricing "Rs 2400 per carton of 20" should never lose precision by being forced into per-piece
-- paisa. Conversion to stock_unit terms happens once, at receipt time, by re-reading
-- purchase_to_stock_factor fresh from products (never snapshotted here).
create table public.purchase_line_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_number text,
  expiry_date date,
  quantity integer not null check (quantity > 0),
  unit_cost_paisa integer not null check (unit_cost_paisa >= 0),
  discount_paisa integer not null default 0 check (discount_paisa >= 0),
  is_free_goods boolean not null default false,
  line_total_paisa integer not null check (line_total_paisa >= 0),
  constraint chk_free_goods_zero_cost check (not is_free_goods or (unit_cost_paisa = 0 and discount_paisa = 0))
);

create index idx_purchase_line_items_tenant_purchase on public.purchase_line_items (tenant_id, purchase_id);
create index idx_purchase_line_items_tenant_product on public.purchase_line_items (tenant_id, product_id);

alter table public.purchase_line_items enable row level security;

create or replace function public.enforce_purchase_line_items_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_purchase_tenant_id uuid;
  v_purchase_status text;
  v_product_tenant_id uuid;
begin
  select tenant_id, status into v_purchase_tenant_id, v_purchase_status
    from public.purchases where id = new.purchase_id;

  if v_purchase_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_line_items.purchase_id must belong to the same tenant';
  end if;

  if v_purchase_status is distinct from 'draft' then
    raise exception 'purchase line items can only be inserted while the purchase is in draft status';
  end if;

  select tenant_id into v_product_tenant_id from public.products where id = new.product_id;
  if v_product_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_line_items.product_id must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_purchase_line_items_tenant_consistency() from public;
revoke execute on function public.enforce_purchase_line_items_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_purchase_line_items_tenant_consistency
before insert on public.purchase_line_items
for each row execute function public.enforce_purchase_line_items_tenant_consistency();
