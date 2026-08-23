-- Platform admin panel, part 3: an audit trail for platform-admin actions.
--
-- public.audit_log cannot be reused for this: its actor_user_id/session_user_id columns are
-- `not null references public.users(id)`, enforced by a trigger that requires both belong to the
-- action's own tenant_id (20260726100006_audit_log.sql) -- exactly wrong for an admin acting
-- across tenants with no public.users row at all. This table mirrors audit_log's shape and
-- discipline (append-only, no update/delete path in app code) with an identity/scope that actually
-- fits a cross-tenant actor.
create table public.platform_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.platform_admins(id) on delete restrict,
  -- Nullable and on delete set null, not restrict: some admin actions aren't about a single tenant
  -- (e.g. a future "admin login" event), and tests/rls/helpers.ts#cleanupTenant hard-deletes tenant
  -- fixtures in the RLS test suite -- a restrict here would break that the moment any test exercises
  -- an admin action against a fixture tenant, exactly as audit_log's own restrict-on-tenant would
  -- have if audit_log itself weren't scoped to a live tenant for its whole lifetime.
  target_tenant_id uuid references public.tenants(id) on delete set null,
  action text not null,      -- dotted verb, e.g. 'tenant.suspend', 'tenant.reactivate', 'tenant.notify'
  summary text not null,     -- human-readable one-liner
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index idx_platform_admin_audit_log_admin_id on public.platform_admin_audit_log (admin_id);
create index idx_platform_admin_audit_log_target_tenant_id on public.platform_admin_audit_log (target_tenant_id);
create index idx_platform_admin_audit_log_created_at on public.platform_admin_audit_log (created_at desc);

alter table public.platform_admin_audit_log enable row level security;

-- Same "RLS-enabled-with-zero-policies" pattern as platform_admins and audit_log -- reads go
-- exclusively through the admin panel's own Route Handlers via the service-role admin client.
--
-- Not tenant-scoped (no not-null tenant_id column) -- intentionally excluded from
-- tests/rls/rls-enabled.test.ts and tests/rls/helpers.ts's tenant child table list.
