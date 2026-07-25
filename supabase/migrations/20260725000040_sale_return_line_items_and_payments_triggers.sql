create or replace function public.enforce_sale_return_line_items_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_return_tenant_id uuid;
  v_sale_line_item_tenant_id uuid;
  v_product_tenant_id uuid;
begin
  select tenant_id into v_return_tenant_id from public.sale_returns where id = new.sale_return_id;
  select tenant_id into v_sale_line_item_tenant_id from public.sale_line_items where id = new.sale_line_item_id;
  select tenant_id into v_product_tenant_id from public.products where id = new.product_id;

  if v_return_tenant_id is distinct from new.tenant_id
    or v_sale_line_item_tenant_id is distinct from new.tenant_id
    or v_product_tenant_id is distinct from new.tenant_id
  then
    raise exception 'sale_return_line_items: sale_return_id/sale_line_item_id/product_id must all belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_sale_return_line_items_tenant_consistency() from public;
revoke execute on function public.enforce_sale_return_line_items_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_sale_return_line_items_tenant_consistency
before insert on public.sale_return_line_items
for each row execute function public.enforce_sale_return_line_items_tenant_consistency();


create or replace function public.enforce_sale_return_payments_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_return_tenant_id uuid;
begin
  select tenant_id into v_return_tenant_id from public.sale_returns where id = new.sale_return_id;

  if v_return_tenant_id is distinct from new.tenant_id then
    raise exception 'sale_return_payments.tenant_id must match the sale_return''s tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_sale_return_payments_tenant_consistency() from public;
revoke execute on function public.enforce_sale_return_payments_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_sale_return_payments_tenant_consistency
before insert on public.sale_return_payments
for each row execute function public.enforce_sale_return_payments_tenant_consistency();
