-- Same defense-in-depth reasoning as enforce_category_depth(): writes go through the
-- service-role admin client (bypasses RLS), so nothing else stops a buggy app-code path from
-- linking a product to another tenant's category or units. Checked here instead of relying on
-- the FK alone, since a plain FK has no concept of "same tenant as the referencing row."
create or replace function public.enforce_product_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  if new.category_id is not null then
    select tenant_id into v_tenant_id from public.categories where id = new.category_id;
    if v_tenant_id is distinct from new.tenant_id then
      raise exception 'category_id must belong to the same tenant as the product';
    end if;
  end if;

  select tenant_id into v_tenant_id from public.units where id = new.stock_unit_id;
  if v_tenant_id is distinct from new.tenant_id then
    raise exception 'stock_unit_id must belong to the same tenant as the product';
  end if;

  if new.purchase_unit_id is not null then
    select tenant_id into v_tenant_id from public.units where id = new.purchase_unit_id;
    if v_tenant_id is distinct from new.tenant_id then
      raise exception 'purchase_unit_id must belong to the same tenant as the product';
    end if;
  end if;

  if new.sale_unit_id is not null then
    select tenant_id into v_tenant_id from public.units where id = new.sale_unit_id;
    if v_tenant_id is distinct from new.tenant_id then
      raise exception 'sale_unit_id must belong to the same tenant as the product';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_product_tenant_consistency() from public;
revoke execute on function public.enforce_product_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_product_tenant_consistency
before insert or update on public.products
for each row execute function public.enforce_product_tenant_consistency();
