-- Phase 7: "Basic subscription/trial gate: trial countdown banner, manual contact-to-subscribe
-- flow (no payment gateway integration yet -- you'll invoice/collect manually from first
-- customers)." Deliberately non-blocking -- an expired trial nudges, it never locks a shopkeeper
-- out of their own data. The whole point of this phase's scope is that there is no payment
-- gateway yet, so a hard lock would have no way for a real customer to actually pay their way back
-- in; it would just be a wall.
--
-- 14 days is a plain, defensible default trial length -- not specified in plan.md, chosen here
-- rather than left unset because an unset trial_ends_at would make every tenant either always-
-- expired or never-expiring depending on how the banner's null-check is written, and that
-- ambiguity is exactly the kind of thing that should be a deliberate choice, not an accident.
alter table public.tenants
  add column trial_ends_at timestamptz not null default (now() + interval '14 days');

-- Existing tenants (created before this column existed) get a fresh 14-day window starting now,
-- rather than being retroactively expired the instant this migration runs -- there is no
-- meaningful "trial start date" to reconstruct for a pre-launch tenant, and expiring real/test
-- shops on deploy would be a self-inflicted, confusing outage for no reason.
update public.tenants set trial_ends_at = now() + interval '14 days';
