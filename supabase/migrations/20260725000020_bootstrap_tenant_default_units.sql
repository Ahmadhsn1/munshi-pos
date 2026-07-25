-- create or replace with the same signature as 20260725000008_bootstrap_tenant_rpc.sql, adding a
-- default-unit seed insert in the same transaction as tenant+owner creation, so a tenant is never
-- left without a base unit catalog before their first product can be created.
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

  insert into public.units (tenant_id, key, name) values
    (v_tenant_id, 'piece', 'Piece'),
    (v_tenant_id, 'kg', 'Kilogram'),
    (v_tenant_id, 'g', 'Gram'),
    (v_tenant_id, 'litre', 'Litre'),
    (v_tenant_id, 'ml', 'Millilitre'),
    (v_tenant_id, 'dozen', 'Dozen'),
    (v_tenant_id, 'carton', 'Carton'),
    (v_tenant_id, 'packet', 'Packet'),
    (v_tenant_id, 'box', 'Box');

  return query select v_tenant_id, p_owner_id;
end;
$$;

-- create or replace does not reset grants, but re-stating them keeps this migration
-- self-contained and correct if it's ever the first place someone reads bootstrap_tenant's
-- privilege posture.
revoke execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) from public;
revoke execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) from anon, authenticated;
grant execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) to service_role;
