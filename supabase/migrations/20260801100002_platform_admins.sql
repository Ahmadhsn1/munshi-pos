-- Platform admin panel, part 2: the platform operator's own identity space.
--
-- Deliberately NOT a 4th role bolted onto public.roles/public.users. A platform admin manages
-- every tenant, not one -- giving them a public.users row would mean either a fake/sentinel
-- tenant_id (breaking the "every users row belongs to exactly one real shop" invariant every other
-- table relies on) or a nullable tenant_id (breaking current_tenant_id()'s `not null` assumption
-- and every RLS policy built on it). A fully separate table sidesteps both: a platform admin has a
-- real auth.users row (same primitive bootstrap_tenant already uses for tenant owners) but no
-- public.users row at all -- which means current_tenant_id() naturally returns NULL for them, and
-- `tenant_id = (select public.current_tenant_id())` is never true against NULL. Every existing
-- tenant-scoped RLS policy therefore denies a platform admin by construction if their session were
-- ever used directly against a client-side Supabase call -- a free fail-closed property, not
-- something enforced here.
create table public.platform_admins (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- DELIBERATELY NO POLICY FOR `authenticated` -- same "RLS-enabled-with-zero-policies" pattern as
-- audit_log (20260726100006_audit_log.sql). This table answers "who may act as platform staff";
-- no tenant-side client, including a tenant owner/manager with a real Supabase session, should ever
-- be able to read it. Every admin route authenticates via auth.getUser() and then checks this
-- table's membership server-side through the service-role admin client, which bypasses RLS.
--
-- Not tenant-scoped (no tenant_id column) -- intentionally excluded from
-- tests/rls/rls-enabled.test.ts's tenant-scoped table list and from
-- tests/rls/helpers.ts's TENANT_CHILD_TABLES_IN_DELETE_ORDER.

-- No self-serve path to becoming platform staff -- this table is only ever written by
-- scripts/create-platform-admin.cjs, run manually with the service-role key.
