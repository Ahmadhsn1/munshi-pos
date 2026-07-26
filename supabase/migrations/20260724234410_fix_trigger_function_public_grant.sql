-- Postgres grants EXECUTE to PUBLIC by default on function creation. The prior fix revoked from
-- anon/authenticated directly, but never revoked the still-standing PUBLIC grant, which anon and
-- authenticated inherit through PUBLIC membership regardless. This trigger function should never
-- be part of the exposed API surface at all.
revoke execute on function public.enforce_role_change_rules() from public;
