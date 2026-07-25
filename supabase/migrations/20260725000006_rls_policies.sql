-- tenants: a user may only ever see their own tenant's row. No client-side insert/update/delete
-- policy exists -- tenant creation happens exclusively through the service-role bootstrap_tenant
-- RPC during signup.
create policy "tenants_select_own"
on public.tenants
for select
to authenticated
using (id = (select public.current_tenant_id()));

-- users: row visibility/editability scoped to caller's own tenant. The `(select ...)` wrapper
-- around current_tenant_id() is Supabase's documented RLS performance pattern -- it lets the
-- planner evaluate the function once per statement (initPlan) instead of once per row.
create policy "users_select_own_tenant"
on public.users
for select
to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy "users_update_own_tenant"
on public.users
for update
to authenticated
using (tenant_id = (select public.current_tenant_id()))
with check (tenant_id = (select public.current_tenant_id()));

-- roles / permissions / role_permissions: non-sensitive global reference data, same for every
-- tenant. Readable by any authenticated user; no insert/update/delete policy exists, so RLS
-- implicitly denies client-side mutation of the catalog (only service-role/migrations touch it).
create policy "roles_select_all"
on public.roles
for select
to authenticated
using (true);

create policy "permissions_select_all"
on public.permissions
for select
to authenticated
using (true);

create policy "role_permissions_select_all"
on public.role_permissions
for select
to authenticated
using (true);
