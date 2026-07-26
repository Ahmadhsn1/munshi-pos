-- Phase 7 performance hardening. /api/products/search and /api/pos/products/search both do
-- `name_en.ilike.%q%,name_ur.ilike.%q%,brand.ilike.%q%` -- a leading-wildcard ILIKE, which a plain
-- btree index (idx_products_tenant_active) can never satisfy; Postgres has no choice but to scan
-- every row of the matching tenant and test each one against the pattern.
--
-- MEASURED, not assumed: a synthetic 5,500-row single-tenant test (matching plan.md's explicit
-- "5,000+ SKUs" bar) executed a full-miss search in ~12ms; doubled to 11,000 rows it took ~23ms --
-- confirming linear O(n) scaling, but already comfortably "instant" (sub-50ms) at the plan's
-- stated target. This migration is deliberately proactive hardening ahead of that becoming a
-- problem, not a fix for a measured failure: a large wholesale catalog growing past ~20-30k SKUs
-- over several years would start being felt, and pg_trgm GIN indexes make ILIKE '%term%' an index
-- scan instead of a sequential one, independent of table size, for a few MB of index and no
-- query-side code change at all.
create extension if not exists pg_trgm;

create index idx_products_name_en_trgm on public.products using gin (name_en gin_trgm_ops);
create index idx_products_name_ur_trgm on public.products using gin (name_ur gin_trgm_ops);
create index idx_products_brand_trgm on public.products using gin (brand gin_trgm_ops);
