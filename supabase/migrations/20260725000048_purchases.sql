create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  status text not null check (status in ('draft', 'confirmed', 'partially_received', 'received', 'cancelled')) default 'draft',
  supplier_invoice_number text,
  purchase_date date not null default current_date,
  subtotal_paisa integer not null default 0 check (subtotal_paisa >= 0),
  discount_paisa integer not null default 0 check (discount_paisa >= 0),
  total_paisa integer not null default 0 check (total_paisa >= 0),
  notes text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_purchases_tenant_status on public.purchases (tenant_id, status);
create index idx_purchases_tenant_supplier on public.purchases (tenant_id, supplier_id);

alter table public.purchases enable row level security;
