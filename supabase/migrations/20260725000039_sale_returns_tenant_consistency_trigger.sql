create or replace function public.enforce_sale_returns_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sale_tenant_id uuid;
  v_shift_tenant_id uuid;
  v_cashier_tenant_id uuid;
  v_session_tenant_id uuid;
begin
  select tenant_id into v_sale_tenant_id from public.sales where id = new.sale_id;
  select tenant_id into v_shift_tenant_id from public.shifts where id = new.shift_id;
  select tenant_id into v_cashier_tenant_id from public.users where id = new.cashier_user_id;
  select tenant_id into v_session_tenant_id from public.users where id = new.session_user_id;

  if v_sale_tenant_id is distinct from new.tenant_id
    or v_shift_tenant_id is distinct from new.tenant_id
    or v_cashier_tenant_id is distinct from new.tenant_id
    or v_session_tenant_id is distinct from new.tenant_id
  then
    raise exception 'sale_returns: sale_id/shift_id/cashier_user_id/session_user_id must all belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_sale_returns_tenant_consistency() from public;
revoke execute on function public.enforce_sale_returns_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_sale_returns_tenant_consistency
before insert on public.sale_returns
for each row execute function public.enforce_sale_returns_tenant_consistency();
