-- Fixed global role catalog. The product plan uses exactly these three roles for every tenant --
-- no per-tenant custom roles are ever introduced across the roadmap.
insert into public.roles (key, name, description) values
  ('owner', 'Owner', 'Full access to the shop account'),
  ('manager', 'Manager', 'Manages staff and daily operations'),
  ('cashier', 'Cashier', 'Operates the point of sale counter')
on conflict (key) do nothing;

-- Permission catalog. Later phases add more keys as new modules ship (POS, purchases, khata,
-- reports...).
insert into public.permissions (key, description) values
  ('users.manage', 'Create and edit staff accounts, set PINs'),
  ('users.view', 'View the staff list'),
  ('roles.view', 'View available roles'),
  ('cost_price.view', 'View product cost price'),
  ('settings.manage', 'Change shop-level settings'),
  ('sales.create', 'Create sales / operate the point of sale'),
  -- Phase 2: product/inventory. products.manage covers categories/units/barcodes too -- no
  -- roadmap scenario needs someone managing products but not categories, so splitting those out
  -- would just be permission-key sprawl nobody configures differently. products.view and
  -- inventory.view stay separate keys even though nothing distinguishes them yet: Phase 3's POS
  -- will need cashiers to see the product/barcode catalog without implying ledger/movement-
  -- history visibility, and splitting now costs nothing. No cashier grant seeded yet for any of
  -- these -- deliberate YAGNI, add it in Phase 3 alongside the screen that actually needs it.
  ('products.view', 'View the product catalog'),
  ('products.manage', 'Create/edit products, categories, units, and barcodes'),
  ('inventory.view', 'View stock levels and movement history'),
  ('inventory.adjust', 'Adjust stock and import opening stock'),
  -- Phase 3: point of sale. sales.create already existed (seeded in Phase 1, granted to all three
  -- roles from the start in anticipation of this phase). Discount/return/void are deliberately
  -- NOT granted to cashier -- matches the plan's explicit "bill discount (permission-gated)"
  -- language and inventory.adjust's existing precedent of excluding cashier from anything that
  -- can move money or stock outside the normal sale flow. shifts.open_close IS granted to
  -- cashier -- a cashier must be able to open/close their own shift; shifts.view (seeing every
  -- cashier's shift/variance history) stays owner/manager only. customers.manage is reserved for
  -- a future full customer/khata page (Phase 5's territory) -- checkout-time quick-add only needs
  -- sales.create, already granted to cashier.
  ('sales.discount', 'Apply a line or bill discount'),
  ('sales.return', 'Process a sale return or exchange'),
  ('sales.void', 'Void a completed sale'),
  ('shifts.open_close', 'Open and close your own shift'),
  ('shifts.view', 'View shift and variance history for all cashiers'),
  ('customers.manage', 'Manage the customer/khata master beyond checkout quick-add'),
  -- Phase 4: purchases & suppliers. Zero cashier involvement -- back-office only, matching
  -- customers.manage's precedent of a single flat key with no separate .view (splits only happen
  -- when a lower-privileged role has a genuine read need, which doesn't apply here).
  ('suppliers.manage', 'Manage the supplier master and credit terms'),
  ('purchases.manage', 'Enter, confirm, receive, return, and pay purchase invoices'),
  -- Phase 6: reports, cash book and audit. reports.view is one flat key covering every report
  -- screen -- there is no roadmap scenario where someone may see the sales report but not the
  -- margin report, and the thing that actually needs hiding (cost/margin from a cashier) is
  -- already its own key, cost_price.view. audit.view is deliberately NOT granted to manager;
  -- see the grant block below for why.
  ('reports.view', 'View sales, margin, stock valuation, cashier and cash book reports'),
  ('expenses.manage', 'Record and void shop expenses'),
  ('audit.view', 'View the full audit log')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'owner'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'manager'
  and p.key in (
    'users.manage', 'users.view', 'roles.view', 'cost_price.view', 'sales.create',
    'products.view', 'products.manage', 'inventory.view', 'inventory.adjust',
    'sales.discount', 'sales.return', 'sales.void', 'shifts.open_close', 'shifts.view',
    'customers.manage', 'suppliers.manage', 'purchases.manage',
    -- Phase 6. Note what is absent: audit.view is owner-only. plan.md scopes the audit log as a
    -- "read-only view for owner" and pairs it with "theft visibility" -- and a manager can already
    -- void sales, apply discounts and adjust stock, so they sit INSIDE the trust boundary the log
    -- exists to police. Letting them read it would let the person most able to cause a discrepancy
    -- also confirm exactly what was recorded about them. Mirrored at the DB layer by audit_log
    -- having no client-readable RLS policy at all.
    'reports.view', 'expenses.manage'
  )
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'cashier'
  and p.key in ('roles.view', 'sales.create', 'products.view', 'shifts.open_close')
on conflict do nothing;
