-- Audit finding: every `date` column defaulting to CURRENT_DATE was recording the WRONG business
-- day for the first five hours of every Pakistani day.
--
-- Supabase runs the database in UTC. Pakistan is UTC+5 with no DST. So between 00:00 and 05:00
-- PKT (= 19:00-24:00 UTC the previous day), CURRENT_DATE returns YESTERDAY's date. Verified live:
-- at 2026-07-25 22:56 UTC, CURRENT_DATE was '2026-07-25' while the shop's actual date was
-- '2026-07-26'.
--
-- For a shop that routinely trades late into the night this silently mis-dates real money:
--   * customer_payments.paid_at  -> khata aging buckets and the customer ledger
--   * purchase_payments.paid_at  -> supplier ledger
--   * purchases.purchase_date    -> payables aging buckets (daysOld is computed from it)
--
-- Fixed by defaulting to the shop's own business date rather than the server's UTC date. The app
-- is Pakistan-specific by design (see plan.md), so Asia/Karachi is the correct business timezone
-- to hard-code here; if this ever becomes multi-region, this belongs on the tenant record.
--
-- Existing rows are intentionally NOT back-filled: there is no way to tell, after the fact,
-- whether a given historical date was recorded during the affected window or not.
alter table public.customer_payments
  alter column paid_at set default (now() at time zone 'Asia/Karachi')::date;

alter table public.purchase_payments
  alter column paid_at set default (now() at time zone 'Asia/Karachi')::date;

alter table public.purchases
  alter column purchase_date set default (now() at time zone 'Asia/Karachi')::date;
