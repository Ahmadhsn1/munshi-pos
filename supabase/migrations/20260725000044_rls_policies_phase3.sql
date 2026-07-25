-- SELECT-only policies for every new Phase 3 table, the established Phase 2 shape. All
-- INSERT/UPDATE goes through Route Handlers using the service-role admin client after a
-- getActingUserContext()/getCurrentUserContext() permission check.
create policy "customers_select_own_tenant"
on public.customers
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "shifts_select_own_tenant"
on public.shifts
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "sale_number_counters_select_own_tenant"
on public.sale_number_counters
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "sales_select_own_tenant"
on public.sales
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "sale_line_items_select_own_tenant"
on public.sale_line_items
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "sale_payments_select_own_tenant"
on public.sale_payments
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "sale_returns_select_own_tenant"
on public.sale_returns
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "sale_return_line_items_select_own_tenant"
on public.sale_return_line_items
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "sale_return_payments_select_own_tenant"
on public.sale_return_payments
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));
