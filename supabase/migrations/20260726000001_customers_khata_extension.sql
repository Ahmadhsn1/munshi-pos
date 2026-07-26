-- Phase 5: extends the "minimal khata primitive" from Phase 3 with the fields that phase's own
-- migration comment explicitly deferred here: credit limit, price tier (tier LOGIC is Phase 7,
-- this is just the field), and a blacklist/stop-supply flag.
alter table public.customers
  add column credit_limit_paisa integer check (credit_limit_paisa is null or credit_limit_paisa >= 0),
  add column price_tier text,
  add column is_blacklisted boolean not null default false;
