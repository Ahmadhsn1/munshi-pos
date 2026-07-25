-- Locks in a draft purchase: recomputes totals server-side from stored line items (never trusts
-- a client-submitted total, same discipline as complete_sale), and flips status so line items
-- become immutable (enforce_purchase_line_items_tenant_consistency only allows INSERT while
-- status='draft') -- the same "no more editing lines once physical receiving can reference them"
-- reasoning as Phase 3's checkout.
create or replace function public.confirm_purchase(
  p_tenant_id uuid,
  p_purchase_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_purchase record;
  v_subtotal integer := 0;
  v_discount integer := 0;
  v_total integer := 0;
  v_line_count integer := 0;
begin
  select * into v_purchase from public.purchases where id = p_purchase_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'Purchase not found';
  end if;

  if v_purchase.status <> 'draft' then
    raise exception 'Purchase is not a draft (status: %)', v_purchase.status;
  end if;

  select count(*), coalesce(sum(unit_cost_paisa * quantity), 0), coalesce(sum(discount_paisa), 0)
    into v_line_count, v_subtotal, v_discount
    from public.purchase_line_items
    where purchase_id = p_purchase_id;

  if v_line_count = 0 then
    raise exception 'Cannot confirm a purchase with no line items';
  end if;

  v_total := v_subtotal - v_discount;

  update public.purchases set
    status = 'confirmed',
    subtotal_paisa = v_subtotal,
    discount_paisa = v_discount,
    total_paisa = v_total
  where id = p_purchase_id;

  return jsonb_build_object('purchaseId', p_purchase_id, 'totalPaisa', v_total);
end;
$$;

revoke execute on function public.confirm_purchase(uuid, uuid) from public;
revoke execute on function public.confirm_purchase(uuid, uuid) from anon, authenticated;
grant execute on function public.confirm_purchase(uuid, uuid) to service_role;
