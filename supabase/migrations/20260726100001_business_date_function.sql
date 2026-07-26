-- Phase 6: every report in this phase groups money by *business day*, and getting that wrong is
-- not cosmetic -- migration 20260726000007 already documented the live proof that Supabase runs in
-- UTC while the shop trades in UTC+5, so a naive `completed_at::date` files the first five hours
-- of every Pakistani day under YESTERDAY. That bug was fixed for stored `date` DEFAULTs there;
-- this function is the read-side counterpart, so no report has to re-spell the conversion (and
-- re-introduce the bug by forgetting it once).
--
-- IMMUTABLE is correct and load-bearing here: `timestamptz at time zone <literal>` is immutable in
-- Postgres (the conversion depends only on the input instant and a fixed zone, not on the session
-- TimeZone setting), which is what allows this to be used in an index expression below.
-- Asia/Karachi is hard-coded for the same reason migration ...0007 hard-codes it: the product is
-- Pakistan-specific by design. If this ever goes multi-region, this belongs on the tenant record.
create or replace function public.business_date(ts timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$ select (ts at time zone 'Asia/Karachi')::date $$;

comment on function public.business_date(timestamptz) is
  'Converts an instant to the shop business day (Asia/Karachi). Use this instead of ::date in any report that groups by day.';

-- Not SECURITY DEFINER and touches no tables, so it is safe to leave callable by authenticated --
-- it is pure arithmetic on its argument. Reports run server-side, but leaving the grant in place
-- keeps it usable from RLS predicates and generated columns without a privilege surprise later.

-- Backs the day-bucketed sales reports. Partial: voided sales are excluded from every report, so
-- there is no reason to carry them in the index.
create index idx_sales_tenant_business_date
  on public.sales (tenant_id, public.business_date(completed_at))
  where status = 'completed';
