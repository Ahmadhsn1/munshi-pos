-- Phase 6. Money-correctness canary, in the same spirit as check_rls_enabled: PostgREST cannot
-- express these cross-table aggregate reconciliations, so a Vitest test (which only has API
-- access) has no way to ask "does the recorded money still add up?" without an RPC.
--
-- WHY THIS EXISTS. Every phase so far has been verified with tsc + lint + tests + build, and every
-- one of those is structurally blind to *stored data drifting away from its own source of truth*.
-- They prove the code that was written runs; they cannot prove that products.current_stock still
-- equals the sum of its ledger, or that a sale's stored total still matches its own line items.
-- Those are exactly the failures a shopkeeper notices first and trusts least -- and by the time
-- they notice, the wrong number is already in a customer's hand.
--
-- Each row returned is a VIOLATION COUNT that must be zero. The test asserts all-zero, so adding a
-- new invariant here automatically strengthens the test with no test-side change.
--
-- FIXTURE FILTERING. Only complete_sale() and record_sale_return() ever set invoice_number /
-- return_number. Rows lacking them were INSERTed directly by RLS test fixtures to exercise policy
-- behaviour and were never required to be internally consistent, so including them would make this
-- permanently red for reasons that say nothing about production correctness. The filter is a
-- statement about provenance ("did this go through the app's own money path"), not a way to
-- exclude inconvenient rows.
create or replace function public.check_money_integrity()
returns table (check_name text, violation_count bigint)
language sql
security definer
set search_path = ''
stable
as $$
  -- products.current_stock is a maintained projection of the append-only stock_ledger
  -- (20260725000019_stock_projection_trigger). If the trigger ever missed a row, or anything wrote
  -- current_stock directly, the projection and its ledger diverge and every stock figure in the
  -- app is quietly wrong.
  select 'current_stock_matches_ledger'::text, count(*)::bigint
  from public.products p
  join (
    select product_id, sum(quantity_delta) as ledger_qty
    from public.stock_ledger group by product_id
  ) l on l.product_id = p.id
  where p.current_stock <> l.ledger_qty

  union all
  -- A completed sale's stored total must still equal its own line-item arithmetic.
  select 'sale_total_matches_line_items', count(*)::bigint
  from public.sales s
  join (
    select sale_id,
           sum(quantity * unit_price_paisa) as subtotal,
           sum(line_discount_paisa) as line_disc,
           sum(tax_paisa) as tax
    from public.sale_line_items group by sale_id
  ) lm on lm.sale_id = s.id
  where s.status = 'completed' and s.invoice_number is not null
    and s.total_paisa <> (lm.subtotal - lm.line_disc - s.bill_discount_paisa + lm.tax + s.round_off_paisa)

  union all
  -- Payments must sum to exactly the total. complete_sale enforces this at write time; this
  -- catches anything that later edited a payment or a total out from under it.
  select 'sale_payments_sum_to_total', count(*)::bigint
  from public.sales s
  left join (
    select sale_id, sum(amount_paisa) as paid from public.sale_payments group by sale_id
  ) p on p.sale_id = s.id
  where s.status = 'completed' and s.invoice_number is not null
    and coalesce(p.paid, 0) <> s.total_paisa

  union all
  -- Refunds must sum to the return total, on the same reasoning.
  select 'return_refunds_sum_to_total', count(*)::bigint
  from public.sale_returns sr
  left join (
    select sale_return_id, sum(amount_paisa) as refunded
    from public.sale_return_payments group by sale_return_id
  ) f on f.sale_return_id = sr.id
  where sr.return_number is not null and coalesce(f.refunded, 0) <> sr.total_paisa

  union all
  -- Returning more than was sold is a straightforward refund-fraud vector, and would also drive
  -- stock permanently upward out of nothing.
  select 'no_line_returned_more_than_sold', count(*)::bigint
  from (
    select sale_line_item_id, sum(quantity) as qty_returned
    from public.sale_return_line_items group by sale_line_item_id
  ) r
  join public.sale_line_items li on li.id = r.sale_line_item_id
  where r.qty_returned > li.quantity

  union all
  -- complete_sale refuses to oversell, so negative stock means something bypassed it.
  select 'no_negative_stock', count(*)::bigint
  from public.products where current_stock < 0

  union all
  -- A negative average cost makes every margin figure downstream nonsense.
  select 'no_negative_avg_cost', count(*)::bigint
  from public.products where avg_cost_paisa < 0

  union all
  -- Udhaar with nobody attached is money that can never be collected. Enforced at write time by
  -- 20260726000003; this proves no pre-existing row violates it either.
  select 'no_khata_sale_without_customer', count(*)::bigint
  from public.sale_payments sp
  join public.sales s on s.id = sp.sale_id
  where sp.payment_mode = 'khata' and s.customer_id is null

  union all
  -- Money must be whole paisa everywhere (absolute rule 1). A fractional value here would mean a
  -- float crept into a column that is supposed to be an integer type.
  select 'all_money_is_whole_paisa', count(*)::bigint
  from public.sales
  where total_paisa <> trunc(total_paisa) or subtotal_paisa <> trunc(subtotal_paisa)
$$;

revoke execute on function public.check_money_integrity() from public;
revoke execute on function public.check_money_integrity() from anon, authenticated;
grant execute on function public.check_money_integrity() to service_role;
