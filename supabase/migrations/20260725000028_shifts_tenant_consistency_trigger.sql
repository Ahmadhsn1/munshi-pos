-- Same defense-in-depth reasoning as Phase 2's enforce_*_tenant_consistency triggers: writes go
-- through the service-role admin client (bypasses RLS), so nothing else stops a buggy route from
-- opening a shift with a cashier/session user from a different tenant.
create or replace function public.enforce_shift_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cashier_tenant_id uuid;
  v_session_tenant_id uuid;
begin
  select tenant_id into v_cashier_tenant_id from public.users where id = new.cashier_user_id;
  select tenant_id into v_session_tenant_id from public.users where id = new.session_user_id;

  if v_cashier_tenant_id is distinct from new.tenant_id then
    raise exception 'shifts.cashier_user_id must belong to the same tenant';
  end if;

  if v_session_tenant_id is distinct from new.tenant_id then
    raise exception 'shifts.session_user_id must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_shift_tenant_consistency() from public;
revoke execute on function public.enforce_shift_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_shift_tenant_consistency
before insert on public.shifts
for each row execute function public.enforce_shift_tenant_consistency();
