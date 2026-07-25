alter table public.stock_ledger drop constraint stock_ledger_movement_type_check;
alter table public.stock_ledger add constraint stock_ledger_movement_type_check
  check (movement_type in ('opening_stock', 'adjustment', 'sale', 'sale_return', 'purchase', 'purchase_return'));

alter table public.stock_ledger add column purchase_id uuid references public.purchases(id) on delete restrict;
alter table public.stock_ledger add column purchase_return_id uuid references public.purchase_returns(id) on delete restrict;

alter table public.stock_ledger drop constraint chk_stock_ledger_reference_matches_type;
alter table public.stock_ledger add constraint chk_stock_ledger_reference_matches_type check (
  (movement_type = 'sale' and sale_id is not null and sale_return_id is null and purchase_id is null and purchase_return_id is null) or
  (movement_type = 'sale_return' and sale_return_id is not null and sale_id is null and purchase_id is null and purchase_return_id is null) or
  (movement_type = 'purchase' and purchase_id is not null and sale_id is null and sale_return_id is null and purchase_return_id is null) or
  (movement_type = 'purchase_return' and purchase_return_id is not null and sale_id is null and sale_return_id is null and purchase_id is null) or
  (movement_type in ('opening_stock', 'adjustment') and sale_id is null and sale_return_id is null and purchase_id is null and purchase_return_id is null)
);
