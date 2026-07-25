-- Standard event-log + materialized-projection pattern: stock_ledger is the append-only source
-- of truth, products.current_stock is a denormalized read-optimization kept in sync here. Every
-- write to stock_ledger goes through a service-role Route Handler (no client insert policy on
-- this table at all -- see 20260725000020_rls_policies_phase2.sql), and service_role already has
-- full UPDATE rights on products, bypassing RLS -- so this trigger does not need
-- SECURITY DEFINER, one fewer such surface to audit.
create or replace function public.apply_stock_ledger_to_products()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.products
  set current_stock = current_stock + new.quantity_delta
  where id = new.product_id;

  return new;
end;
$$;

revoke execute on function public.apply_stock_ledger_to_products() from public;
revoke execute on function public.apply_stock_ledger_to_products() from anon, authenticated;

create trigger trg_apply_stock_ledger_to_products
after insert on public.stock_ledger
for each row execute function public.apply_stock_ledger_to_products();
