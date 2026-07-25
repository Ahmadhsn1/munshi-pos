-- Covers both "return" and "void": void is a full return of every not-yet-returned line
-- (p_reason_code='void', p_mark_sale_void=true), computed by the caller (Route Handler) as the
-- full remaining-returnable line set. Reuses sale_number_counters for return numbers too (shared
-- per-tenant sequence, 'RET-' prefixed so they're visually distinct from invoice numbers, no
-- separate counter table needed).
create or replace function public.record_sale_return(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_shift_id uuid,
  p_cashier_user_id uuid,
  p_session_user_id uuid,
  p_reason_code text,
  p_note text,
  p_lines jsonb,             -- [{sale_line_item_id, quantity}]
  p_refund_payments jsonb,   -- [{payment_mode, amount_paisa, reference_text}]
  p_mark_sale_void boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sale record;
  v_line jsonb;
  v_original record;
  v_already_returned integer;
  v_remaining integer;
  v_return_quantity integer;
  v_line_tax integer;
  v_line_total integer;
  v_subtotal integer := 0;
  v_tax_total integer := 0;
  v_total integer;
  v_return_id uuid;
  v_return_seq integer;
  v_return_number text;
  v_payment jsonb;
  v_refund_sum integer := 0;
  v_stock_delta integer;
begin
  select * into v_sale from public.sales where id = p_sale_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'Sale not found';
  end if;

  if v_sale.status <> 'completed' then
    raise exception 'Can only return items from a completed sale (status: %)', v_sale.status;
  end if;

  insert into public.sale_returns (
    tenant_id, sale_id, shift_id, cashier_user_id, session_user_id,
    reason_code, note, subtotal_paisa, tax_paisa, total_paisa
  ) values (
    p_tenant_id, p_sale_id, p_shift_id, p_cashier_user_id, p_session_user_id,
    p_reason_code, p_note, 0, 0, 0
  )
  returning id into v_return_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_original
      from public.sale_line_items
      where id = (v_line ->> 'sale_line_item_id')::uuid and sale_id = p_sale_id;

    if not found then
      raise exception 'Line item % does not belong to this sale', v_line ->> 'sale_line_item_id';
    end if;

    select coalesce(sum(quantity), 0) into v_already_returned
      from public.sale_return_line_items
      where sale_line_item_id = v_original.id;

    v_remaining := v_original.quantity - v_already_returned;
    v_return_quantity := (v_line ->> 'quantity')::integer;

    if v_return_quantity > v_remaining then
      raise exception 'Cannot return % of product % -- only % remaining',
        v_return_quantity, v_original.product_id, v_remaining;
    end if;

    -- Tax prorated by quantity against the original line's own recorded tax -- keeps a partial
    -- return's tax portion consistent with what was actually charged, not recomputed from a
    -- possibly-since-changed product tax rate.
    v_line_tax := round(v_original.tax_paisa::numeric * v_return_quantity / v_original.quantity);
    v_line_total := v_original.unit_price_paisa * v_return_quantity + v_line_tax;

    insert into public.sale_return_line_items (
      tenant_id, sale_return_id, sale_line_item_id, product_id,
      quantity, unit_price_paisa, tax_paisa, line_total_paisa
    ) values (
      p_tenant_id, v_return_id, v_original.id, v_original.product_id,
      v_return_quantity, v_original.unit_price_paisa, v_line_tax, v_line_total
    );

    v_subtotal := v_subtotal + v_original.unit_price_paisa * v_return_quantity;
    v_tax_total := v_tax_total + v_line_tax;

    select v_return_quantity * sale_to_stock_factor into v_stock_delta
      from public.products where id = v_original.product_id;

    insert into public.stock_ledger (
      tenant_id, product_id, movement_type, quantity_delta, sale_return_id, created_by
    ) values (
      p_tenant_id, v_original.product_id, 'sale_return', v_stock_delta, v_return_id, p_cashier_user_id
    );
  end loop;

  v_total := v_subtotal + v_tax_total;

  for v_payment in select * from jsonb_array_elements(p_refund_payments)
  loop
    v_refund_sum := v_refund_sum + (v_payment ->> 'amount_paisa')::integer;

    insert into public.sale_return_payments (tenant_id, sale_return_id, payment_mode, amount_paisa, reference_text)
    values (
      p_tenant_id, v_return_id, v_payment ->> 'payment_mode',
      (v_payment ->> 'amount_paisa')::integer, nullif(v_payment ->> 'reference_text', '')
    );
  end loop;

  if v_refund_sum <> v_total then
    raise exception 'Refund payments (%) do not sum to the return total (%)', v_refund_sum, v_total;
  end if;

  insert into public.sale_number_counters (tenant_id, next_number)
  values (p_tenant_id, 2)
  on conflict (tenant_id) do update set next_number = sale_number_counters.next_number + 1
  returning next_number - 1 into v_return_seq;

  v_return_number := 'RET-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_return_seq::text, 5, '0');

  update public.sale_returns
    set subtotal_paisa = v_subtotal, tax_paisa = v_tax_total, total_paisa = v_total, return_number = v_return_number
    where id = v_return_id;

  if p_mark_sale_void then
    update public.sales
      set status = 'void', voided_at = now(), voided_by = p_cashier_user_id, void_reason = p_reason_code
      where id = p_sale_id;
  end if;

  return jsonb_build_object('saleReturnId', v_return_id, 'returnNumber', v_return_number, 'totalPaisa', v_total);
end;
$$;

revoke execute on function public.record_sale_return(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, boolean) from public;
revoke execute on function public.record_sale_return(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, boolean) from anon, authenticated;
grant execute on function public.record_sale_return(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, boolean) to service_role;
