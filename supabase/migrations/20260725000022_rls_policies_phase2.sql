-- Every Phase 2 table gets a SELECT-only policy for `authenticated` (same tenant-scoped shape as
-- Phase 1). All INSERT/UPDATE goes through Route Handlers using the service-role admin client
-- after a getCurrentUserContext() permission check -- one consistent, server-validated write path
-- for every new table, rather than Phase 1's mixed pattern (users has a client UPDATE policy
-- narrowed by column grants). This also means current_stock never needs a column-privilege
-- migration: there's no client UPDATE policy on products to narrow in the first place.

create policy "units_select_own_tenant"
on public.units
for select
to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "categories_select_own_tenant"
on public.categories
for select
to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "products_select_own_tenant"
on public.products
for select
to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "product_barcodes_select_own_tenant"
on public.product_barcodes
for select
to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "stock_ledger_select_own_tenant"
on public.stock_ledger
for select
to authenticated
using (tenant_id = (select public.current_tenant_id()));
