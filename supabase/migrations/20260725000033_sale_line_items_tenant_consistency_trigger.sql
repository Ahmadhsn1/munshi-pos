create or replace function public.enforce_sale_line_items_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sale_tenant_id uuid;
  v_product_tenant_id uuid;
begin
  select tenant_id into v_sale_tenant_id from public.sales where id = new.sale_id;
  select tenant_id into v_product_tenant_id from public.products where id = new.product_id;

  if v_sale_tenant_id is distinct from new.tenant_id then
    raise exception 'sale_line_items.tenant_id must match the sale''s tenant';
  end if;

  if v_product_tenant_id is distinct from new.tenant_id then
    raise exception 'sale_line_items.product_id must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_sale_line_items_tenant_consistency() from public;
revoke execute on function public.enforce_sale_line_items_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_sale_line_items_tenant_consistency
before insert on public.sale_line_items
for each row execute function public.enforce_sale_line_items_tenant_consistency();
