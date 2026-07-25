-- Combines two checks in one BEFORE INSERT trigger (deliberately INSERT only, not UPDATE -- a
-- sale legitimately keeps referencing its shift after that shift later closes, e.g. when the
-- sale is completed or voided post-close; only creation needs to be scoped to a currently-open
-- shift):
--   1. Standard tenant-consistency defense-in-depth (same reasoning as every other Phase 2/3
--      enforce_*_tenant_consistency trigger -- the admin client bypasses RLS).
--   2. The shift a new sale references must actually be open. This is also checked in the
--      Route Handler (which resolves the caller's own open shift server-side), but the DB backstop
--      matters here specifically since a stale client could otherwise attach a new sale to an
--      already-closed shift and silently corrupt that shift's already-computed variance.
create or replace function public.enforce_sales_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cashier_tenant_id uuid;
  v_session_tenant_id uuid;
  v_customer_tenant_id uuid;
  v_shift_tenant_id uuid;
  v_shift_status text;
begin
  select tenant_id into v_cashier_tenant_id from public.users where id = new.cashier_user_id;
  select tenant_id into v_session_tenant_id from public.users where id = new.session_user_id;

  if v_cashier_tenant_id is distinct from new.tenant_id then
    raise exception 'sales.cashier_user_id must belong to the same tenant';
  end if;

  if v_session_tenant_id is distinct from new.tenant_id then
    raise exception 'sales.session_user_id must belong to the same tenant';
  end if;

  if new.customer_id is not null then
    select tenant_id into v_customer_tenant_id from public.customers where id = new.customer_id;
    if v_customer_tenant_id is distinct from new.tenant_id then
      raise exception 'sales.customer_id must belong to the same tenant';
    end if;
  end if;

  select tenant_id, status into v_shift_tenant_id, v_shift_status
    from public.shifts where id = new.shift_id;

  if v_shift_tenant_id is distinct from new.tenant_id then
    raise exception 'sales.shift_id must belong to the same tenant';
  end if;

  if v_shift_status is distinct from 'open' then
    raise exception 'sales.shift_id must reference an open shift';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_sales_tenant_consistency() from public;
revoke execute on function public.enforce_sales_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_sales_tenant_consistency
before insert on public.sales
for each row execute function public.enforce_sales_tenant_consistency();
