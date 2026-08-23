-- Phase 6: sales/margin/cashier/stock-valuation reports.
--
-- SHARED CONVENTION WITH get_cash_book, restated here because getting it backwards silently
-- corrupts a report rather than erroring: a sale/return is attributed to the BUSINESS DAY the
-- event itself happened on (completed_at for a sale, created_at for a return), via
-- public.business_date() -- never ::date on a UTC timestamp, and never the day of some other
-- related row. A return that lands on a later day than its original sale correctly shows up as a
-- negative on the return's own day; this is standard "gross with returns netted to the day they
-- were returned" reporting and matches how the cash book already treats it.
--
-- VOIDED SALES. A void is recorded as a full return (record_sale_return with p_mark_sale_void)
-- rather than deleted, so filtering on `status = 'completed'` would double-count nothing but WOULD
-- silently drop the original sale's revenue while an equal-and-opposite return sits uncounted in a
-- status filter that also excludes it -- net effect: understating revenue by the voided amount
-- with no corresponding correction. The correct filter is `invoice_number is not null` (only
-- complete_sale() ever sets it, so it is proof the sale genuinely went through the till), with
-- every return -- void-triggered or a genuine partial return -- subtracted on its own day
-- regardless of status. Same reasoning as get_cash_book and check_money_integrity's fixture filter.
--
-- COGS uses stock_ledger.unit_cost_paisa, the historical cost SNAPSHOT stamped at the moment of
-- sale (see 20260725000058) -- never products.avg_cost_paisa, which is today's average and would
-- silently misstate the margin on every past sale the moment cost ever changes.

create or replace function public.get_sales_summary(
  p_tenant_id uuid,
  p_from date,
  p_to date
)
returns table (
  business_day date,
  revenue_paisa bigint,
  discount_paisa bigint,
  tax_paisa bigint,
  cogs_paisa bigint,
  transaction_count bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as business_day
  ),
  sale_totals as (
    select
      public.business_date(s.completed_at) as business_day,
      sum(s.total_paisa) as revenue,
      sum(s.line_discount_paisa + s.bill_discount_paisa) as discount,
      sum(s.tax_paisa) as tax,
      count(*) as tx_count
    from public.sales s
    where s.tenant_id = p_tenant_id
      and s.invoice_number is not null
      and public.business_date(s.completed_at) between p_from and p_to
    group by 1
  ),
  return_totals as (
    select
      public.business_date(sr.created_at) as business_day,
      sum(sr.total_paisa) as returned,
      sum(sr.tax_paisa) as returned_tax
    from public.sale_returns sr
    where sr.tenant_id = p_tenant_id
      and public.business_date(sr.created_at) between p_from and p_to
    group by 1
  ),
  cogs as (
    select
      public.business_date(sl.created_at) as business_day,
      sum(-sl.quantity_delta * sl.unit_cost_paisa) as cogs
    from public.stock_ledger sl
    where sl.tenant_id = p_tenant_id
      and sl.movement_type in ('sale', 'sale_return')
      and public.business_date(sl.created_at) between p_from and p_to
    group by 1
  )
  select
    d.business_day,
    (coalesce(st.revenue, 0) - coalesce(rt.returned, 0))::bigint,
    coalesce(st.discount, 0)::bigint,
    (coalesce(st.tax, 0) - coalesce(rt.returned_tax, 0))::bigint,
    coalesce(c.cogs, 0)::bigint,
    coalesce(st.tx_count, 0)::bigint
  from days d
  left join sale_totals st on st.business_day = d.business_day
  left join return_totals rt on rt.business_day = d.business_day
  left join cogs c on c.business_day = d.business_day
  order by d.business_day
$$;

revoke execute on function public.get_sales_summary(uuid, date, date) from public;
revoke execute on function public.get_sales_summary(uuid, date, date) from anon, authenticated;
grant execute on function public.get_sales_summary(uuid, date, date) to service_role;

-- GOTCHA found while verifying this against live data, easy to reintroduce if either function is
-- ever rewritten: this revenue_paisa is TAX-INCLUSIVE (sales.total_paisa, net of returns), while
-- get_product_sales.revenue_paisa below is TAX-EXCLUSIVE (tax_paisa is a separate per-line column,
-- never folded into unit_price_paisa). They are not expected to sum to the same total -- a naive
-- side-by-side comparison will always show a gap equal to net tax collected, which looks exactly
-- like missing data if you don't already know this. Confirmed live: Rs 982.40 tax-inclusive here
-- against Rs 840.00 tax-exclusive there for the same period; the Rs 142.40 gap is net tax, not a
-- bug. Label report UI columns explicitly ("incl. tax" / "excl. tax") rather than just "Revenue".
comment on function public.get_sales_summary(uuid, date, date) is
  'Day-level sales report. revenue_paisa is TAX-INCLUSIVE (sales.total_paisa, net of returns) -- do not compare directly to get_product_sales.revenue_paisa, which is tax-exclusive by construction.';

-- Per-product breakdown, with category/brand attached so one query serves "by item", "by
-- category" and "by brand" -- the UI groups/sorts client-side rather than needing three RPCs for
-- what is the same underlying rows. Quantity and revenue are NET of returns; a bill-level discount
-- is not prorated per line (documented limitation -- see the discount_paisa comment below).
create or replace function public.get_product_sales(
  p_tenant_id uuid,
  p_from date,
  p_to date
)
returns table (
  product_id uuid,
  product_name text,
  category_name text,
  brand text,
  quantity_sold_net bigint,
  revenue_paisa bigint,
  discount_paisa bigint,
  cogs_paisa bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  with sold as (
    select
      li.product_id,
      sum(li.quantity) as qty,
      sum(li.quantity * li.unit_price_paisa) as revenue,
      -- Line-level discount only. bill_discount_paisa is a single bill-wide figure with no
      -- natural per-line allocation, so it is deliberately left out of the per-product figure
      -- rather than prorated by an arbitrary rule; get_sales_summary's day-level discount total
      -- is where the bill discount is fully accounted for.
      sum(li.line_discount_paisa) as discount
    from public.sale_line_items li
    join public.sales s on s.id = li.sale_id
    where s.tenant_id = p_tenant_id
      and s.invoice_number is not null
      and public.business_date(s.completed_at) between p_from and p_to
    group by li.product_id
  ),
  returned as (
    select
      rli.product_id,
      sum(rli.quantity) as qty,
      sum(rli.quantity * rli.unit_price_paisa) as revenue
    from public.sale_return_line_items rli
    join public.sale_returns sr on sr.id = rli.sale_return_id
    where sr.tenant_id = p_tenant_id
      and public.business_date(sr.created_at) between p_from and p_to
    group by rli.product_id
  ),
  cogs as (
    select sl.product_id, sum(-sl.quantity_delta * sl.unit_cost_paisa) as cogs
    from public.stock_ledger sl
    where sl.tenant_id = p_tenant_id
      and sl.movement_type in ('sale', 'sale_return')
      and public.business_date(sl.created_at) between p_from and p_to
    group by sl.product_id
  )
  select
    p.id,
    p.name_en,
    cat.name,
    p.brand,
    (coalesce(so.qty, 0) - coalesce(rt.qty, 0))::bigint,
    (coalesce(so.revenue, 0) - coalesce(rt.revenue, 0))::bigint,
    coalesce(so.discount, 0)::bigint,
    coalesce(c.cogs, 0)::bigint
  from public.products p
  left join public.categories cat on cat.id = p.category_id
  join sold so on so.product_id = p.id
  left join returned rt on rt.product_id = p.id
  left join cogs c on c.product_id = p.id
  where p.tenant_id = p_tenant_id
$$;

revoke execute on function public.get_product_sales(uuid, date, date) from public;
revoke execute on function public.get_product_sales(uuid, date, date) from anon, authenticated;
grant execute on function public.get_product_sales(uuid, date, date) to service_role;

comment on function public.get_product_sales(uuid, date, date) is
  'Per-product sales report. revenue_paisa is TAX-EXCLUSIVE (quantity * unit_price_paisa, net of returns) -- tax_paisa is a separate per-line-item column never folded in. Will not sum to get_sales_summary.revenue_paisa, which is tax-inclusive.';

-- Cashier-wise sales/discount/return -- plan.md's explicit "theft visibility" report. Attributed
-- to cashier_user_id, which is the ACTING identity at the time of sale (the cashier PIN'd in at
-- the counter, not the owner/manager device the session runs on) -- see the sales/sale_returns
-- schema and ENGINEERING.md's acting-vs-session note. That is what makes this report actually mean
-- "which staff member did this" rather than "which device".
create or replace function public.get_cashier_report(
  p_tenant_id uuid,
  p_from date,
  p_to date
)
returns table (
  cashier_user_id uuid,
  cashier_name text,
  sale_count bigint,
  revenue_paisa bigint,
  discount_given_paisa bigint,
  return_count bigint,
  return_paisa bigint,
  void_count bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  with sales_agg as (
    select
      s.cashier_user_id,
      count(*) filter (where s.status <> 'void') as sale_count,
      sum(s.total_paisa) filter (where s.status <> 'void') as revenue,
      sum(s.line_discount_paisa + s.bill_discount_paisa) filter (where s.status <> 'void') as discount,
      count(*) filter (where s.status = 'void') as void_count
    from public.sales s
    where s.tenant_id = p_tenant_id
      and s.invoice_number is not null
      and public.business_date(s.completed_at) between p_from and p_to
    group by s.cashier_user_id
  ),
  returns_agg as (
    select sr.cashier_user_id, count(*) as return_count, sum(sr.total_paisa) as return_paisa
    from public.sale_returns sr
    where sr.tenant_id = p_tenant_id
      and public.business_date(sr.created_at) between p_from and p_to
    group by sr.cashier_user_id
  ),
  cashier_ids as (
    select cashier_user_id from sales_agg
    union
    select cashier_user_id from returns_agg
  )
  select
    u.id,
    u.full_name,
    coalesce(sa.sale_count, 0)::bigint,
    coalesce(sa.revenue, 0)::bigint,
    coalesce(sa.discount, 0)::bigint,
    coalesce(ra.return_count, 0)::bigint,
    coalesce(ra.return_paisa, 0)::bigint,
    coalesce(sa.void_count, 0)::bigint
  from cashier_ids ci
  join public.users u on u.id = ci.cashier_user_id
  left join sales_agg sa on sa.cashier_user_id = ci.cashier_user_id
  left join returns_agg ra on ra.cashier_user_id = ci.cashier_user_id
$$;

revoke execute on function public.get_cashier_report(uuid, date, date) from public;
revoke execute on function public.get_cashier_report(uuid, date, date) from anon, authenticated;
grant execute on function public.get_cashier_report(uuid, date, date) to service_role;

-- Stock valuation is a SNAPSHOT of right now, not a date-range report: "what is currently sitting
-- on the shelf worth" has no notion of a period. Uses avg_cost_paisa deliberately (unlike the
-- sales reports above) -- valuing today's stock at today's average cost is the correct question
-- here; historical unit_cost_paisa would answer a different one ("what did the stock we've since
-- sold cost us"), which is what the margin reports above are for.
create or replace function public.get_stock_valuation(p_tenant_id uuid)
returns table (
  product_id uuid,
  product_name text,
  category_name text,
  current_stock integer,
  avg_cost_paisa integer,
  valuation_paisa bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    p.id,
    p.name_en,
    cat.name,
    p.current_stock,
    p.avg_cost_paisa,
    (p.current_stock::bigint * p.avg_cost_paisa::bigint)
  from public.products p
  left join public.categories cat on cat.id = p.category_id
  where p.tenant_id = p_tenant_id
    and p.is_active = true
    and p.current_stock > 0
$$;

revoke execute on function public.get_stock_valuation(uuid) from public;
revoke execute on function public.get_stock_valuation(uuid) from anon, authenticated;
grant execute on function public.get_stock_valuation(uuid) to service_role;
