-- Phase 6: "full audit log (who changed what, when) -- read-only view for owner".
--
-- Append-only, exactly like public.stock_ledger: corrections are new rows, never an UPDATE or
-- DELETE of an existing one. As with stock_ledger this cannot be enforced against service_role at
-- the DB level (every write in this app goes through the admin client), so it is an app-code
-- discipline rule -- there is deliberately no update/delete path in src/lib/audit.ts.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- WHO IS ACTUALLY RESPONSIBLE. actor_user_id is the *acting* identity from
  -- getActingUserContext() -- i.e. the cashier who is PIN'd in at the counter -- while
  -- session_user_id is the owner/manager whose real Supabase session the device is running under.
  -- Recording only one of these makes the log useless for its stated purpose: only actor_user_id
  -- answers "which cashier did this", and only session_user_id answers "on whose logged-in device".
  -- Same two-column shape already used by public.sales and public.sale_returns.
  actor_user_id uuid not null references public.users(id) on delete restrict,
  session_user_id uuid not null references public.users(id) on delete restrict,
  action text not null,        -- dotted verb, e.g. 'sale.void', 'stock.adjust', 'expense.void'
  entity_type text not null,   -- e.g. 'sale', 'product', 'customer', 'expense', 'user'
  entity_id uuid,              -- nullable: some actions (bulk import) have no single subject row
  summary text not null,       -- human-readable one-liner rendered directly in the owner's view
  before_data jsonb,           -- null for creates
  after_data jsonb,            -- null for deletes/voids where the void columns say it all
  created_at timestamptz not null default now()
);

-- The owner's view is "newest first, this tenant, optionally filtered" -- hence the desc index.
create index idx_audit_log_tenant_created_at on public.audit_log (tenant_id, created_at desc);
create index idx_audit_log_tenant_entity on public.audit_log (tenant_id, entity_type, entity_id);
create index idx_audit_log_tenant_actor on public.audit_log (tenant_id, actor_user_id);
create index idx_audit_log_session_user_id on public.audit_log (session_user_id);

alter table public.audit_log enable row level security;

-- DELIBERATELY NO POLICY FOR `authenticated`.
--
-- Every other tenant-scoped table in this app gets a tenant-wide SELECT policy, because "anyone
-- signed into this shop may read this shop's data" is the right default for products, sales,
-- expenses and so on. The audit log is the one table where that default is actively wrong: its
-- entire purpose (per plan.md, "cashier-wise ... theft visibility" / "read-only view for owner")
-- is to let the OWNER audit their own staff -- including managers, who do hold real Supabase
-- sessions and could otherwise just read the table straight from the client and see precisely
-- which of their own actions were recorded.
--
-- RLS enabled with zero policies denies all access to anon/authenticated while leaving service_role
-- (which bypasses RLS) working. Reads therefore go exclusively through a Route Handler that checks
-- the `audit.view` permission -- owner-only -- with the admin client. This is the same
-- "SELECT-only-RLS-plus-admin-client-writes" philosophy from Phase 2 taken one step further to
-- "no-client-reads-at-all", and it is why there is no audit_log policy to review below.
--
-- The rls-enabled meta-test (tests/rls/rls-enabled.test.ts) still covers this table: it asserts
-- relrowsecurity = true, which is exactly the property doing the work here.

create or replace function public.enforce_audit_log_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor_tenant_id uuid;
  v_session_tenant_id uuid;
begin
  select tenant_id into v_actor_tenant_id from public.users where id = new.actor_user_id;
  if v_actor_tenant_id is distinct from new.tenant_id then
    raise exception 'audit_log.actor_user_id must belong to the same tenant';
  end if;

  select tenant_id into v_session_tenant_id from public.users where id = new.session_user_id;
  if v_session_tenant_id is distinct from new.tenant_id then
    raise exception 'audit_log.session_user_id must belong to the same tenant';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_audit_log_tenant_consistency() from public;
revoke execute on function public.enforce_audit_log_tenant_consistency() from anon, authenticated;

create trigger trg_enforce_audit_log_tenant_consistency
before insert on public.audit_log
for each row execute function public.enforce_audit_log_tenant_consistency();
