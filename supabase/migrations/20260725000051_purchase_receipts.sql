-- Goods receipt is a separate append-only event family (mirrors sale_returns/sale_return_line_items'
-- header+lines shape) rather than an in-place counter on purchase_line_items -- preserves the
-- forensic trail of who received what, when, possibly across separate physical deliveries against
-- one invoice ("partial receipt supported").
create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  received_by uuid not null references public.users(id) on delete restrict,
  note text,
  created_at timestamptz not null default now()
);

create index idx_purchase_receipts_tenant_purchase on public.purchase_receipts (tenant_id, purchase_id);

alter table public.purchase_receipts enable row level security;

create or replace function public.enforce_purchase_receipts_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_purchase_tenant_id uuid;
  v_received_by_tenant_id uuid;
begin
  select tenant_id into v_purchase_tenant_id from public.purchases where id = new.purchase_id;
  if v_purchase_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_receipts.purchase_id must belong to the same tenant';
  end if;

  select tenant_id into v_received_by_tenant_id from public.users where id = new.received_by;
  if v_received_by_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_receipts.received_by must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_purchase_receipts_tenant_consistency() from public;
revoke execute on function public.enforce_purchase_receipts_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_purchase_receipts_tenant_consistency
before insert on public.purchase_receipts
for each row execute function public.enforce_purchase_receipts_tenant_consistency();

-- quantity_received is in STOCK_UNIT terms (needed for the stock_ledger insert and the cost math).
-- unit_cost_net_paisa is an audit snapshot only (the net per-stock-unit cost this receipt actually
-- contributed to the weighted average) -- never re-derived later.
create table public.purchase_receipt_line_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  purchase_receipt_id uuid not null references public.purchase_receipts(id) on delete restrict,
  purchase_line_item_id uuid not null references public.purchase_line_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_received integer not null check (quantity_received > 0),
  unit_cost_net_paisa integer not null check (unit_cost_net_paisa >= 0)
);

create index idx_purchase_receipt_line_items_tenant_receipt on public.purchase_receipt_line_items (tenant_id, purchase_receipt_id);
create index idx_purchase_receipt_line_items_purchase_line_item on public.purchase_receipt_line_items (purchase_line_item_id);

alter table public.purchase_receipt_line_items enable row level security;

create or replace function public.enforce_purchase_receipt_line_items_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_receipt_tenant_id uuid;
  v_line_item_tenant_id uuid;
  v_product_tenant_id uuid;
begin
  select tenant_id into v_receipt_tenant_id from public.purchase_receipts where id = new.purchase_receipt_id;
  if v_receipt_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_receipt_line_items.purchase_receipt_id must belong to the same tenant';
  end if;

  select tenant_id into v_line_item_tenant_id from public.purchase_line_items where id = new.purchase_line_item_id;
  if v_line_item_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_receipt_line_items.purchase_line_item_id must belong to the same tenant';
  end if;

  select tenant_id into v_product_tenant_id from public.products where id = new.product_id;
  if v_product_tenant_id is distinct from new.tenant_id then
    raise exception 'purchase_receipt_line_items.product_id must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_purchase_receipt_line_items_tenant_consistency() from public;
revoke execute on function public.enforce_purchase_receipt_line_items_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_purchase_receipt_line_items_tenant_consistency
before insert on public.purchase_receipt_line_items
for each row execute function public.enforce_purchase_receipt_line_items_tenant_consistency();
