-- Seeds the starter expense-category set for NEW tenants, in the same transaction as tenant+owner
-- creation -- exactly how default units are handled (20260725000020). The previous migration
-- back-fills existing tenants; this covers everyone created from now on.
--
-- Signature is unchanged from 20260725000020, so this is a genuine in-place replace and does NOT
-- create a stray overload (the trap documented for RPCs that gain a trailing parameter).
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

  insert into public.expense_categories (tenant_id, key, name) values
    (v_tenant_id, 'rent', 'Rent'),
    (v_tenant_id, 'utilities', 'Utilities (bijli/gas/paani)'),
    (v_tenant_id, 'salaries', 'Salaries & wages'),
    (v_tenant_id, 'transport', 'Transport & freight'),
    (v_tenant_id, 'supplies', 'Shop supplies'),
    (v_tenant_id, 'maintenance', 'Repairs & maintenance'),
    (v_tenant_id, 'tea_food', 'Tea & food'),
    (v_tenant_id, 'other', 'Other');

  return query select v_tenant_id, p_owner_id;
end;
$$;

revoke execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) from public;
revoke execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) from anon, authenticated;
grant execute on function public.bootstrap_tenant(uuid, text, text, text, text, text) to service_role;
