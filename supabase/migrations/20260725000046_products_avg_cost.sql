-- Running weighted-average cost, per ONE STOCK_UNIT (matches current_stock's unit, so
-- current_stock * avg_cost_paisa is a valid valuation without a unit-conversion step). Maintained
-- going forward by record_goods_receipt (Phase 4) -- never by a trigger, since cost is a
-- purchase-specific concern, not something sales/returns/adjustments touch.
alter table public.products
  add column avg_cost_paisa integer not null default 0 check (avg_cost_paisa >= 0);

-- Backfill: a product's only-ever cost signal today is its (at most one, per Phase 2's partial
-- unique index uq_stock_ledger_opening_stock_once) opening_stock row's unit_cost_paisa.
update public.products p
set avg_cost_paisa = coalesce(sl.unit_cost_paisa, 0)
from public.stock_ledger sl
where sl.product_id = p.id
  and sl.movement_type = 'opening_stock';
