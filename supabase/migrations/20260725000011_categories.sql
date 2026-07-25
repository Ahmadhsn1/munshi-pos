create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  parent_category_id uuid references public.categories(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique per (tenant, parent, name). coalesce() is required: Postgres unique indexes treat
-- NULL <> NULL, so without it two identically-named top-level categories (parent_category_id
-- both null) could both be inserted.
create unique index uq_categories_tenant_parent_name
  on public.categories (
    tenant_id,
    coalesce(parent_category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

create index idx_categories_tenant_id on public.categories (tenant_id);

alter table public.categories enable row level security;

create trigger trg_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();
