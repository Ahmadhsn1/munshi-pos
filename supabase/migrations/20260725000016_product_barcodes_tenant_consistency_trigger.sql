-- Same defense-in-depth reasoning as the products/categories tenant-consistency triggers.
create or replace function public.enforce_barcode_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_product_tenant_id uuid;
begin
  select tenant_id into v_product_tenant_id from public.products where id = new.product_id;

  if v_product_tenant_id is distinct from new.tenant_id then
    raise exception 'product_barcodes.tenant_id must match the product''s tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_barcode_tenant_consistency() from public;
revoke execute on function public.enforce_barcode_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_barcode_tenant_consistency
before insert or update on public.product_barcodes
for each row execute function public.enforce_barcode_tenant_consistency();
