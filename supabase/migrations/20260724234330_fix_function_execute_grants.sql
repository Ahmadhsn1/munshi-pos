-- Supabase's default `ALTER DEFAULT PRIVILEGES` setup grants EXECUTE on every new function in
-- the public schema to anon/authenticated/service_role, separately from the PUBLIC pseudo-role.
-- Revoking only from PUBLIC (as the original migrations did) left anon/authenticated still able
-- to call these directly via PostgREST RPC -- confirmed by get_advisors. Closing that gap here.

-- bootstrap_tenant: must be service_role only. If anon/authenticated could call this, any
-- unauthenticated visitor could mint an arbitrary tenant and attach an arbitrary existing
-- auth.users id as its "owner".
revoke execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) from anon, authenticated;

-- current_tenant_id: authenticated is intentional (used directly by RLS policies, and harmless
-- to call directly -- returns only the caller's own tenant_id). anon has no legitimate use.
revoke execute on function public.current_tenant_id() from anon;

-- enforce_role_change_rules: a trigger function, never meant to be part of the exposed API.
revoke execute on function public.enforce_role_change_rules() from anon, authenticated;
