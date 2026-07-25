-- Deferred from 20260725000036 -- sale_returns didn't exist yet at that point.
alter table public.stock_ledger
  add column sale_return_id uuid references public.sale_returns(id) on delete restrict;

-- Keeps a stock_ledger row's reference column matched to its movement_type -- a 'sale' row must
-- carry sale_id and no sale_return_id, a 'sale_return' row the reverse, and the pre-existing
-- movement types carry neither.
alter table public.stock_ledger add constraint chk_stock_ledger_reference_matches_type check (
  (movement_type = 'sale' and sale_id is not null and sale_return_id is null) or
  (movement_type = 'sale_return' and sale_return_id is not null and sale_id is null) or
  (movement_type in ('opening_stock', 'adjustment') and sale_id is null and sale_return_id is null)
);
