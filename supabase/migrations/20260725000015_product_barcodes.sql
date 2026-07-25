-- Plural "barcode(s)" in the product plan implies multiple codes per product (different pack
-- sizes, or a manufacturer reassigning a code over time). Uniqueness is scoped (tenant_id,
-- barcode), not global -- two different tenants can legitimately stock a product that shares the
-- same real-world EAN/UPC; global uniqueness would incorrectly block the second tenant. No
-- checksum validation (many kiryana products carry informal/hand-labeled codes) -- just
-- non-empty/trimmed/reasonable-length, enforced at the Zod layer (lib/validation.ts), not here.
create table public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete cascade,
  barcode text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index uq_product_barcodes_tenant_barcode on public.product_barcodes (tenant_id, barcode);
create unique index uq_product_barcodes_one_primary on public.product_barcodes (product_id) where is_primary;
create index idx_product_barcodes_product_id on public.product_barcodes (product_id);

alter table public.product_barcodes enable row level security;
