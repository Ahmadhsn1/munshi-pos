-- Bootstraps a brand-new tenant + its owner user in one transaction. RLS blocks self-service
-- inserts into tenants/users (there is no client insert policy on either), so the very first
-- signup for a shop has to go through a privileged, single-transaction path. Called only by the
-- service-role client from the /api/auth/signup route, after auth.users has already been created
-- via supabase.auth.admin.createUser().
--
-- p_owner_id must already exist in auth.users. Execute is granted to service_role only -- an
-- ordinary authenticated user can never call this to mint themselves a new tenant.
create or replace function public.bootstrap_tenant(
  p_owner_id uuid,
  p_tenant_name text,
  p_tenant_slug text,
  p_owner_full_name text,
  p_owner_email text,
  p_owner_phone text
)
returns table (tenant_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_owner_role_id uuid;
begin
  insert into public.tenants (name, slug)
  values (p_tenant_name, p_tenant_slug)
  returning id into v_tenant_id;

  select id into v_owner_role_id from public.roles where key = 'owner';

  if v_owner_role_id is null then
    raise exception 'owner role is not seeded';
  end if;

  insert into public.users (id, tenant_id, role_id, full_name, email, phone)
  values (p_owner_id, v_tenant_id, v_owner_role_id, p_owner_full_name, p_owner_email, p_owner_phone);

  return query select v_tenant_id, p_owner_id;
end;
$$;

-- Revoking from PUBLIC alone is not enough here either -- see the same note in
-- 20260725000005_rls_functions.sql. Confirmed via get_advisors that without the explicit
-- anon/authenticated revoke, any unauthenticated visitor could call this directly and mint an
-- arbitrary tenant with an arbitrary existing auth.users id attached as its "owner".
revoke execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) from public;
revoke execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) from anon, authenticated;
grant execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) to service_role;
