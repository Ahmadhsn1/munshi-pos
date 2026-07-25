-- BEFORE INSERT only (mirrors the sales trigger's reasoning) -- a purchase legitimately keeps
-- referencing its supplier/creator after later edits; only creation needs the cross-tenant guard.
create or replace function public.enforce_purchases_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_supplier_tenant_id uuid;
  v_created_by_tenant_id uuid;
begin
  select tenant_id into v_supplier_tenant_id from public.suppliers where id = new.supplier_id;
  if v_supplier_tenant_id is distinct from new.tenant_id then
    raise exception 'purchases.supplier_id must belong to the same tenant';
  end if;

  select tenant_id into v_created_by_tenant_id from public.users where id = new.created_by;
  if v_created_by_tenant_id is distinct from new.tenant_id then
    raise exception 'purchases.created_by must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_purchases_tenant_consistency() from public;
revoke execute on function public.enforce_purchases_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_purchases_tenant_consistency
before insert on public.purchases
for each row execute function public.enforce_purchases_tenant_consistency();
