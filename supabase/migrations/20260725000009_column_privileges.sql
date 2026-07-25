-- Row Level Security is row-scoped only -- it cannot restrict individual columns. Without this,
-- any authenticated user within a tenant could `select pin_hash, pin_salt from users` for every
-- coworker. Column-level privileges close that gap: pin_hash/pin_salt are never selectable or
-- updatable by the `authenticated` role under any circumstance. Only the service-role client
-- (used exclusively in trusted server routes: staff creation, counter-login) ever touches them --
-- service_role bypasses grants and RLS alike, by design.
revoke select on public.users from authenticated;
grant select (
  id, tenant_id, role_id, full_name, phone, email, is_active,
  pin_attempts, pin_locked_until, created_at, updated_at
) on public.users to authenticated;

revoke update on public.users from authenticated;
grant update (full_name, phone, email, is_active, role_id)
  on public.users to authenticated;
