-- Global reference catalogs. Deliberately NOT tenant-scoped: the product plan uses exactly
-- three fixed roles (owner/manager/cashier) for every tenant, with no per-tenant custom roles
-- anywhere in the roadmap, so this is shared lookup data rather than tenant business data.
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create index idx_role_permissions_permission_id on public.role_permissions (permission_id);

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
