-- SELECT-only, Phase 2/3 shape: every write goes through a Route Handler using the service-role
-- admin client after a permission check. No client INSERT/UPDATE policy on any of these tables.
create policy "suppliers_select_own_tenant"
on public.suppliers
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "purchases_select_own_tenant"
on public.purchases
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "purchase_line_items_select_own_tenant"
on public.purchase_line_items
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "purchase_receipts_select_own_tenant"
on public.purchase_receipts
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "purchase_receipt_line_items_select_own_tenant"
on public.purchase_receipt_line_items
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "purchase_returns_select_own_tenant"
on public.purchase_returns
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "purchase_return_line_items_select_own_tenant"
on public.purchase_return_line_items
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "purchase_payments_select_own_tenant"
on public.purchase_payments
for select to authenticated
using (tenant_id = (select public.current_tenant_id()));
