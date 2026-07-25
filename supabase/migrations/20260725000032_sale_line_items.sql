-- quantity/unit_price_paisa are in SALE_UNIT terms (matching products.sale_price_paisa's same
-- convention), not stock_unit terms -- see the note on 20260725000025_products_sale_price.sql.
-- complete_sale converts to stock terms only at the stock_ledger insert, via toStockQuantity(),
-- re-deriving sale_to_stock_factor fresh from products server-side.
create table public.sale_line_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price_paisa integer not null check (unit_price_paisa >= 0),
  line_discount_paisa integer not null default 0 check (line_discount_paisa >= 0),
  tax_paisa integer not null default 0 check (tax_paisa >= 0),
  line_total_paisa integer not null check (line_total_paisa >= 0)
);

create index idx_sale_line_items_sale on public.sale_line_items (sale_id);
create index idx_sale_line_items_product on public.sale_line_items (product_id);

alter table public.sale_line_items enable row level security;
