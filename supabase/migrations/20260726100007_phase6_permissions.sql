-- Phase 6 permission keys. supabase/seed.sql is the canonical catalog and is idempotent, but it
-- only ever runs against a fresh database -- an already-provisioned project needs the new rows
-- applied as a migration too. Kept byte-identical in intent to the matching seed.sql block so the
-- two can never drift into granting different things.
insert into public.permissions (key, description) values
  ('reports.view', 'View sales, margin, stock valuation, cashier and cash book reports'),
  ('expenses.manage', 'Record and void shop expenses'),
  ('audit.view', 'View the full audit log')
on conflict (key) do nothing;

-- Owner gets every permission, including any added later -- same cross join as seed.sql.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'owner'
on conflict do nothing;

-- Manager gets reports and expenses, but NOT audit.view.
--
-- This is the one genuinely non-obvious grant in the phase, so: plan.md scopes the audit log as a
-- "read-only view for owner" and pairs it with "cashier-wise sales/discount/return report (theft
-- visibility)". A manager can already void sales, apply discounts and adjust stock -- they are
-- inside the trust boundary the audit log exists to police, so letting them read it would let the
-- person most able to cause a discrepancy also confirm exactly what was recorded about them.
-- Owner-only is the whole point; this mirrors the table having no client-readable RLS policy at all.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'manager'
  and p.key in ('reports.view', 'expenses.manage')
on conflict do nothing;

-- Cashier gets none of the three. A cashier seeing shop-wide margin/valuation numbers is exactly
-- the cost-visibility leak that cost_price.view exists to prevent.
