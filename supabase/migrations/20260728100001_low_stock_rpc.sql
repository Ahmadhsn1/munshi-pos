-- Dashboard redesign needs "how many products are low on stock" and a short "needs attention"
-- list. `current_stock <= reorder_level` is a COLUMN-vs-COLUMN comparison, which PostgREST/
-- supabase-js cannot express through its query builder (.lte() only compares a column to a
-- literal) -- the alternative would be pulling every active product's stock/reorder_level into JS
-- and filtering there, which is exactly the full-table-scan-on-every-page-load performance mistake
-- already fixed once this phase (see 20260727100001_product_search_trigram_indexes.sql). A tiny
-- RPC is the correct fix here for the same reason an index was the correct fix there.
create or replace function public.get_low_stock_products(p_tenant_id uuid)
returns table (
  product_id uuid,
  product_name text,
  current_stock integer,
  reorder_level integer
)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.name_en, p.current_stock, p.reorder_level
  from public.products p
  where p.tenant_id = p_tenant_id
    and p.is_active = true
    and p.current_stock <= p.reorder_level
  order by (p.current_stock - p.reorder_level) asc
$$;

revoke execute on function public.get_low_stock_products(uuid) from public;
revoke execute on function public.get_low_stock_products(uuid) from anon, authenticated;
grant execute on function public.get_low_stock_products(uuid) to service_role;
