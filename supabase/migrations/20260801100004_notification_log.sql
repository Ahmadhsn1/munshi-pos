-- Platform admin panel, part 4: the admin-facing send-audit trail for every notification attempt,
-- across every channel. This is deliberately a separate table from in_app_notifications
-- (20260801100005) -- one is the admin's own record of what was sent and whether it worked (no
-- client read policy, mirrors audit_log), the other is the tenant's readable inbox. A single table
-- can't serve both jobs: the admin's log needs a row per channel per send attempt (including
-- channels that were skipped/failed), while the tenant's inbox should only ever show something a
-- human at that shop is meant to actually read.
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  channel text not null check (channel in ('in_app', 'email', 'whatsapp')),
  template_key text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error_message text,
  sent_by_admin_id uuid not null references public.platform_admins(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_notification_log_tenant_created_at on public.notification_log (tenant_id, created_at desc);
create index idx_notification_log_sent_by_admin_id on public.notification_log (sent_by_admin_id);

alter table public.notification_log enable row level security;

-- DELIBERATELY NO POLICY FOR `authenticated` -- this is the admin's own send log, not something a
-- tenant should read directly (same "RLS-enabled-with-zero-policies" pattern as audit_log and
-- platform_admins). Rendered to the admin inline on a tenant's detail page via the service-role
-- admin client.
--
-- Genuinely tenant-scoped (not-null tenant_id) -- added to tests/rls/rls-enabled.test.ts's table
-- list and tests/rls/helpers.ts's TENANT_CHILD_TABLES_IN_DELETE_ORDER in this same change.
