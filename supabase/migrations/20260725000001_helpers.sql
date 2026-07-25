-- Shared helper: keeps `updated_at` current on every UPDATE.
-- search_path is pinned empty and all references are schema-qualified, per Supabase's
-- SECURITY DEFINER hardening guidance (prevents search_path hijacking).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Trigger functions are never meant to be part of the exposed PostgREST API. Postgres grants
-- EXECUTE to PUBLIC by default on creation; revoking closes that off (anon/authenticated inherit
-- through PUBLIC membership otherwise, regardless of any role-specific revoke).
revoke execute on function public.set_updated_at() from public;
