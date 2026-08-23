-- Platform admin panel, part 5: the tenant-readable notification inbox -- what actually shows up
-- as a banner/list inside a shop's own dashboard when a platform admin sends them a message
-- through the in-app channel. See notification_log (20260801100004) for why this is a separate
-- table from the admin's own send-audit trail.
create table public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  title text not null,
  body text not null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_in_app_notifications_tenant_dismissed_created
  on public.in_app_notifications (tenant_id, dismissed_at, created_at desc);

alter table public.in_app_notifications enable row level security;

-- A shop's own signed-in users may read their own tenant's notices -- same shape as
-- tenants_select_own (20260725000006_rls_policies.sql). No client UPDATE policy: dismissing a
-- notification goes through a Route Handler (getActingUserContext() scopes to the caller's own
-- tenant, admin client does the write), following the Phase 2
-- SELECT-only-RLS-plus-admin-client-writes pattern rather than a client-writable policy.
create policy "in_app_notifications_select_own_tenant"
on public.in_app_notifications
for select
to authenticated
using (tenant_id = (select public.current_tenant_id()));

-- Genuinely tenant-scoped (not-null tenant_id) -- added to tests/rls/rls-enabled.test.ts's table
-- list and tests/rls/helpers.ts's TENANT_CHILD_TABLES_IN_DELETE_ORDER in this same change.
