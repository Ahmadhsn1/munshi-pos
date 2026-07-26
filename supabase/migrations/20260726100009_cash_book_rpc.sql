-- Phase 6: the daily cash book -- every rupee of physical cash that moved, per business day.
--
-- TWO THINGS HERE ARE EASY TO GET SILENTLY WRONG, so they are spelled out:
--
-- 1. VOIDED SALES MUST STILL COUNT THEIR ORIGINAL CASH-IN. The instinct is to filter
--    `status = 'completed'`, but voiding flips status to 'void' while leaving the original cash
--    payment in place and adding a refund. Filtering on status would drop the 200 that came in and
--    keep the 200 that went out, reporting a 200 loss for a sale that netted zero -- and if the void
--    happened on a later day, it would corrupt two days at once. The money physically entered the
--    drawer when the sale completed, so the filter is `completed_at is not null`: did this sale ever
--    actually take money? (The sales/margin reports are the opposite case -- there a void means the
--    sale did not happen and MUST be excluded. Same data, different question.)
--
-- 2. DAYS ARE BUSINESS DAYS, NOT UTC DAYS. Timestamps go through public.business_date()
--    (Asia/Karachi); date columns are already stored as business dates by their column defaults.
--    Using ::date on a timestamptz would file the first five hours of every Pakistani day under
--    yesterday -- see migration 20260726000007, which fixed exactly that bug on the write side.
create or replace function public.get_cash_book(
  p_tenant_id uuid,
  p_from date,
  p_to date
)
returns table (
  business_day date,
  cash_sales_paisa bigint,
  khata_receipts_paisa bigint,
  refunds_paisa bigint,
  expenses_paisa bigint,
  supplier_payments_paisa bigint,
  net_cash_paisa bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as business_day
  ),
  cash_sales as (
    select public.business_date(s.completed_at) as business_day, sum(sp.amount_paisa) as amt
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
    where s.tenant_id = p_tenant_id
      and sp.payment_mode = 'cash'
      and s.completed_at is not null   -- see note 1: NOT status = 'completed'
      and public.business_date(s.completed_at) between p_from and p_to
    group by 1
  ),
  khata_receipts as (
    select cp.paid_at as business_day, sum(cp.amount_paisa) as amt
    from public.customer_payments cp
    where cp.tenant_id = p_tenant_id
      and cp.payment_mode = 'cash'
      and cp.paid_at between p_from and p_to
    group by 1
  ),
  refunds as (
    select public.business_date(sr.created_at) as business_day, sum(srp.amount_paisa) as amt
    from public.sale_return_payments srp
    join public.sale_returns sr on sr.id = srp.sale_return_id
    where sr.tenant_id = p_tenant_id
      and srp.payment_mode = 'cash'
      and public.business_date(sr.created_at) between p_from and p_to
    group by 1
  ),
  expenses as (
    select e.expense_date as business_day, sum(e.amount_paisa) as amt
    from public.expenses e
    where e.tenant_id = p_tenant_id
      and e.payment_mode = 'cash'
      and e.voided_at is null
      and e.expense_date between p_from and p_to
    group by 1
  ),
  supplier_payments as (
    select pp.paid_at as business_day, sum(pp.amount_paisa) as amt
    from public.purchase_payments pp
    where pp.tenant_id = p_tenant_id
      and pp.payment_mode = 'cash'
      and pp.paid_at between p_from and p_to
    group by 1
  )
  select
    d.business_day,
    coalesce(cs.amt, 0)::bigint,
    coalesce(kr.amt, 0)::bigint,
    coalesce(rf.amt, 0)::bigint,
    coalesce(ex.amt, 0)::bigint,
    coalesce(spp.amt, 0)::bigint,
    (coalesce(cs.amt, 0) + coalesce(kr.amt, 0)
      - coalesce(rf.amt, 0) - coalesce(ex.amt, 0) - coalesce(spp.amt, 0))::bigint
  from days d
  left join cash_sales cs on cs.business_day = d.business_day
  left join khata_receipts kr on kr.business_day = d.business_day
  left join refunds rf on rf.business_day = d.business_day
  left join expenses ex on ex.business_day = d.business_day
  left join supplier_payments spp on spp.business_day = d.business_day
  order by d.business_day
$$;

revoke execute on function public.get_cash_book(uuid, date, date) from public;
revoke execute on function public.get_cash_book(uuid, date, date) from anon, authenticated;
grant execute on function public.get_cash_book(uuid, date, date) to service_role;
