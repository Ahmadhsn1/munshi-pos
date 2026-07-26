-- CORRECTNESS FIX (found while building Phase 6's cash book, affects Phase 5 as shipped).
--
-- A khata customer walking in and paying down their udhaar in CASH puts real money in the counter
-- drawer. But shift close computes expected cash as `opening + cash sales - cash refunds` only
-- (src/app/api/pos/shifts/[id]/close/route.ts), and customer_payments had no link to a shift at
-- all -- so that money was invisible to the reconciliation. Every such payment made the cashier
-- look like they had a cash SURPLUS at close.
--
-- That is the worst possible failure mode for the one report whose entire job is theft visibility:
-- a real shortage can be masked by an unrelated khata payment landing in the same shift, and an
-- honest cashier gets flagged for a variance they did not cause. Phase 6 owns the cash book, so it
-- owns fixing this.
--
-- Nullable, and cash-only, for the same reason as expenses.shift_id: an owner recording a bank
-- transfer or a payment collected away from the counter must not move the cashier's drawer.
alter table public.customer_payments
  add column shift_id uuid references public.shifts(id) on delete restrict;

alter table public.customer_payments
  add constraint customer_payments_shift_requires_cash
  check (shift_id is null or payment_mode = 'cash');

-- Backs shift-close expected-cash: live cash khata receipts for one shift.
create index idx_customer_payments_shift on public.customer_payments (shift_id) where shift_id is not null;

-- Existing rows are deliberately NOT back-filled. There is no reliable way to reconstruct which
-- shift a historical payment belonged to (customer_payments.paid_at is a date, shifts overlap
-- within a day, and the affected shifts are already closed with their variance recorded). Guessing
-- would rewrite recorded financial history to make old numbers look tidier -- the same reasoning
-- migration 20260726000007 used when it declined to back-fill mis-dated business dates.
create or replace function public.enforce_customer_payments_tenant_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_customer_tenant_id uuid;
  v_created_by_tenant_id uuid;
  v_shift_tenant_id uuid;
begin
  select tenant_id into v_customer_tenant_id from public.customers where id = new.customer_id;
  if v_customer_tenant_id is distinct from new.tenant_id then
    raise exception 'customer_payments.customer_id must belong to the same tenant';
  end if;

  select tenant_id into v_created_by_tenant_id from public.users where id = new.created_by;
  if v_created_by_tenant_id is distinct from new.tenant_id then
    raise exception 'customer_payments.created_by must belong to the same tenant';
  end if;

  if new.shift_id is not null then
    select tenant_id into v_shift_tenant_id from public.shifts where id = new.shift_id;
    if v_shift_tenant_id is distinct from new.tenant_id then
      raise exception 'customer_payments.shift_id must belong to the same tenant';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_customer_payments_tenant_consistency() from public;
revoke execute on function public.enforce_customer_payments_tenant_consistency() from anon, authenticated;
