-- Returns the calling user's tenant_id. SECURITY DEFINER + owned by the migration role means
-- the internal lookup on public.users runs as the table owner, which Postgres exempts from RLS
-- (FORCE ROW LEVEL SECURITY is never set on these tables) -- this is what avoids the classic
-- infinite-recursion bug where a users-table RLS policy would otherwise need to query the very
-- table it's protecting. search_path is pinned empty and every reference is schema-qualified,
-- per Supabase's SECURITY DEFINER hardening guidance.
create or replace function public.current_tenant_id()
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select tenant_id from public.users where id = auth.uid()
$$;

-- Revoking from PUBLIC alone is not enough: Supabase's default ALTER DEFAULT PRIVILEGES setup
-- separately grants EXECUTE on new public-schema functions to anon/authenticated/service_role,
-- so anon must be revoked explicitly too (confirmed via the Security Advisor -- it flagged this).
-- authenticated keeps EXECUTE deliberately: it's called directly by RLS policies, and is
-- harmless to call ad-hoc since it only ever returns the caller's own tenant_id.
revoke execute on function public.current_tenant_id() from public;
revoke execute on function public.current_tenant_id() from anon;
grant execute on function public.current_tenant_id() to authenticated;
