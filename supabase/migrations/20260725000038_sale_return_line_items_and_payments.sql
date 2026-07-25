create table public.sale_return_line_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_return_id uuid not null references public.sale_returns(id) on delete restrict,
  sale_line_item_id uuid not null references public.sale_line_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0), -- sale_unit terms; <= remaining returnable, enforced in the RPC
  unit_price_paisa integer not null check (unit_price_paisa >= 0),
  tax_paisa integer not null default 0 check (tax_paisa >= 0),
  line_total_paisa integer not null check (line_total_paisa >= 0)
);

create index idx_sale_return_line_items_return on public.sale_return_line_items (sale_return_id);
create index idx_sale_return_line_items_sale_line on public.sale_return_line_items (sale_line_item_id);

alter table public.sale_return_line_items enable row level security;

create table public.sale_return_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_return_id uuid not null references public.sale_returns(id) on delete restrict,
  payment_mode text not null check (payment_mode in ('cash', 'khata', 'jazzcash', 'easypaisa')),
  amount_paisa integer not null check (amount_paisa > 0),
  reference_text text,
  created_at timestamptz not null default now()
);

create index idx_sale_return_payments_return on public.sale_return_payments (sale_return_id);

alter table public.sale_return_payments enable row level security;
