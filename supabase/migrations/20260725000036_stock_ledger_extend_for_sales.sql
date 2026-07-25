-- Extends stock_ledger's movement_type CHECK to admit sale-driven movements. This is exactly the
-- trivial additive migration Phase 2's comment on this constraint predicted -- plain text + CHECK
-- specifically to avoid the transaction-visibility footguns of ALTER TYPE ... ADD VALUE on a
-- native enum. sale_return_id is added in a later migration (20260725000039), once the
-- sale_returns table exists -- ordering constraint, not a design choice.
alter table public.stock_ledger drop constraint stock_ledger_movement_type_check;
alter table public.stock_ledger add constraint stock_ledger_movement_type_check
  check (movement_type in ('opening_stock', 'adjustment', 'sale', 'sale_return'));

alter table public.stock_ledger add column sale_id uuid references public.sales(id) on delete restrict;

-- The negative-stock guard for Phase 3's checkout. Added NOT VALID then validated separately --
-- safe against any Phase 2 data that went negative during a manual onboarding correction (Phase
-- 2 explicitly allowed that; Phase 3's sale-time guard is a new, stricter rule going forward).
alter table public.products
  add constraint chk_products_current_stock_nonnegative check (current_stock >= 0) not valid;
alter table public.products validate constraint chk_products_current_stock_nonnegative;
