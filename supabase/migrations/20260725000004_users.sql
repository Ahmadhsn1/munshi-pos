-- Tenant-scoped staff profile, 1:1 with auth.users. Every staff member -- including cashiers,
-- who never do a full email/password login -- gets a real auth.users row (cashiers get a
-- synthetic, non-deliverable email + random password set server-side). This keeps the schema
-- simple and lets a cashier graduate to full login later with zero schema change.
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  role_id uuid not null references public.roles(id) on delete restrict,
  full_name text not null,
  phone text,
  email text,
  -- PIN fields: never selectable/updatable via the `authenticated` role (see
  -- 20260725000009_column_privileges.sql). Only service-role server routes touch these.
  pin_hash text,
  pin_salt text,
  pin_attempts int not null default 0,
  pin_locked_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_users_tenant_id on public.users (tenant_id);
create index idx_users_role_id on public.users (role_id);

alter table public.users enable row level security;

create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();
