-- Phase 2 shipped tax_rate_bps/purchase_to_stock_factor/sale_to_stock_factor but never a selling
-- price -- a real gap, found while planning Phase 3. Price is captured PER ONE SALE_UNIT (the
-- unit a cashier actually transacts in via sale_to_stock_factor), not per stock_unit: a
-- shopkeeper naturally prices "Rs 33 per carton of 20 pieces," and dividing that into a
-- per-stock-unit paisa price would lose precision immediately (33/20 = 1.65, not representable
-- as integer paisa). sale_line_items snapshots this same convention at time of sale.
alter table public.products
  add column sale_price_paisa integer not null default 0 check (sale_price_paisa >= 0);
