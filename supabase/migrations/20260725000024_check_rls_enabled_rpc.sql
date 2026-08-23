-- Testing utility: PostgREST doesn't expose pg_catalog, so there's no way for a Vitest test
-- (which only has API access, not a raw Postgres connection) to check whether a migration
-- forgot `ENABLE ROW LEVEL SECURITY` on a new table. This function exposes exactly that one
-- read-only fact (table name + RLS boolean flag, no row data) so tests/rls/rls-enabled.test.ts
-- can catch that mistake automatically instead of relying on a manual Security Advisor pass.
create or replace function public.check_rls_enabled(p_table_names text[])
returns table (table_name text, rls_enabled boolean)
language sql
security definer
set search_path = ''
stable
as $$
  select c.relname, c.relrowsecurity
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any(p_table_names)
$$;

revoke execute on function public.check_rls_enabled(text[]) from public;
revoke execute on function public.check_rls_enabled(text[]) from anon, authenticated;
grant execute on function public.check_rls_enabled(text[]) to service_role;
