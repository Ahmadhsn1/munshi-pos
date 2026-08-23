-- CREATE OR REPLACE FUNCTION with an added trailing parameter does NOT replace the existing
-- function in Postgres -- it creates a second, distinct overload (different argument list = a
-- different function identity). Caught immediately after applying the previous migration: two
-- `complete_sale` functions existed simultaneously -- the OLD 5-arg version (still callable,
-- completely bypassing the new khata enforcement) and the NEW 6-arg version (which, being a
-- genuinely new function object, got Supabase's default ALTER DEFAULT PRIVILEGES grant of
-- EXECUTE to anon/authenticated -- the exact documented gotcha in ENGINEERING.md: revoking from
-- PUBLIC alone is not enough, anon/authenticated get their own separate grant).
--
-- Fix: drop the old 5-arg overload outright (nothing should call it -- the Route Handler always
-- passes 6 args going forward), and lock down the new 6-arg version the same way every other
-- RPC in this app is locked down.
drop function if exists public.complete_sale(uuid, uuid, integer, integer, jsonb);

revoke execute on function public.complete_sale(uuid, uuid, integer, integer, jsonb, boolean) from public;
revoke execute on function public.complete_sale(uuid, uuid, integer, integer, jsonb, boolean) from anon, authenticated;
grant execute on function public.complete_sale(uuid, uuid, integer, integer, jsonb, boolean) to service_role;
