create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  payment_mode text not null check (payment_mode in ('cash', 'khata', 'jazzcash', 'easypaisa')),
  amount_paisa integer not null check (amount_paisa > 0),
  reference_text text,
  created_at timestamptz not null default now()
);

create index idx_sale_payments_sale on public.sale_payments (sale_id);

alter table public.sale_payments enable row level security;
