-- Same class of issue as enforce_role_change_rules: a trigger function, never meant to be
-- callable directly via the exposed PostgREST API.
revoke execute on function public.set_updated_at() from public;
