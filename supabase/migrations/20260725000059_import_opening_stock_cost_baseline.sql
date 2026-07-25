-- Phase 4 addition: a product whose only-ever stock event is an opening-stock import with a cost
-- still needs a correct avg_cost_paisa baseline, not just a stock_ledger.unit_cost_paisa record --
-- otherwise it would silently stay 0 until (if ever) a real purchase receipt happens, breaking
-- Phase 6's valuation/margin reports for any shop that opened with priced stock rather than a
-- Phase 4 purchase. Safe/idempotent: this only runs on the same branch that inserts the one-and-
-- only opening_stock row a product can ever have (Phase 2's partial unique index guarantees that).
create or replace function public.import_opening_stock(
  p_tenant_id uuid,
  p_created_by uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb;
  v_row_num integer;
  v_category_id uuid;
  v_stock_unit_id uuid;
  v_purchase_unit_id uuid;
  v_sale_unit_id uuid;
  v_product_id uuid;
  v_barcode text;
  v_opening_quantity integer;
  v_has_opening_stock boolean;
  v_total_rows integer := 0;
  v_products_created integer := 0;
  v_opening_stock_recorded integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_total_rows := v_total_rows + 1;
    v_row_num := (v_row->>'row')::integer;

    begin
      v_category_id := null;
      if nullif(trim(v_row->>'category_name'), '') is not null then
        select id into v_category_id
          from public.categories
          where tenant_id = p_tenant_id
            and parent_category_id is null
            and lower(name) = lower(trim(v_row->>'category_name'));

        if v_category_id is null then
          insert into public.categories (tenant_id, name)
          values (p_tenant_id, trim(v_row->>'category_name'))
          returning id into v_category_id;
        end if;
      end if;

      select id into v_stock_unit_id
        from public.units
        where tenant_id = p_tenant_id and lower(key) = lower(trim(v_row->>'stock_unit_key'));

      if v_stock_unit_id is null then
        raise exception 'Unknown stock unit "%"', v_row->>'stock_unit_key';
      end if;

      v_purchase_unit_id := null;
      if nullif(trim(v_row->>'purchase_unit_key'), '') is not null then
        select id into v_purchase_unit_id
          from public.units
          where tenant_id = p_tenant_id and lower(key) = lower(trim(v_row->>'purchase_unit_key'));

        if v_purchase_unit_id is null then
          raise exception 'Unknown purchase unit "%"', v_row->>'purchase_unit_key';
        end if;
      end if;

      v_sale_unit_id := null;
      if nullif(trim(v_row->>'sale_unit_key'), '') is not null then
        select id into v_sale_unit_id
          from public.units
          where tenant_id = p_tenant_id and lower(key) = lower(trim(v_row->>'sale_unit_key'));

        if v_sale_unit_id is null then
          raise exception 'Unknown sale unit "%"', v_row->>'sale_unit_key';
        end if;
      end if;

      v_barcode := nullif(trim(v_row->>'barcode'), '');
      v_product_id := null;

      if v_barcode is not null then
        select product_id into v_product_id
          from public.product_barcodes
          where tenant_id = p_tenant_id and barcode = v_barcode;
      end if;

      if v_product_id is null then
        insert into public.products (
          tenant_id, name_en, name_ur, category_id, brand,
          stock_unit_id, purchase_unit_id, purchase_to_stock_factor,
          sale_unit_id, sale_to_stock_factor, tax_rate_bps, reorder_level
        ) values (
          p_tenant_id,
          v_row->>'name_en',
          nullif(v_row->>'name_ur', ''),
          v_category_id,
          nullif(v_row->>'brand', ''),
          v_stock_unit_id,
          v_purchase_unit_id,
          coalesce((v_row->>'purchase_to_stock_factor')::integer, 1),
          v_sale_unit_id,
          coalesce((v_row->>'sale_to_stock_factor')::integer, 1),
          coalesce((v_row->>'tax_rate_bps')::integer, 0),
          coalesce((v_row->>'reorder_level')::integer, 0)
        )
        returning id into v_product_id;

        v_products_created := v_products_created + 1;

        if v_barcode is not null then
          insert into public.product_barcodes (tenant_id, product_id, barcode, is_primary)
          values (p_tenant_id, v_product_id, v_barcode, true);
        end if;
      end if;

      v_opening_quantity := coalesce((v_row->>'opening_quantity')::integer, 0);

      select exists(
        select 1 from public.stock_ledger
        where product_id = v_product_id and movement_type = 'opening_stock'
      ) into v_has_opening_stock;

      if v_has_opening_stock then
        v_skipped := v_skipped || jsonb_build_object(
          'row', v_row_num, 'message', 'Product already has opening stock recorded'
        );
      elsif v_opening_quantity <> 0 then
        insert into public.stock_ledger (
          tenant_id, product_id, movement_type, quantity_delta, unit_cost_paisa, created_by
        ) values (
          p_tenant_id, v_product_id, 'opening_stock', v_opening_quantity,
          nullif(v_row->>'unit_cost_paisa', '')::integer, p_created_by
        );

        update public.products
          set avg_cost_paisa = coalesce(nullif(v_row->>'unit_cost_paisa', '')::integer, 0)
          where id = v_product_id;

        v_opening_stock_recorded := v_opening_stock_recorded + 1;
      end if;

    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_row_num, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'totalRows', v_total_rows,
    'productsCreated', v_products_created,
    'openingStockRecorded', v_opening_stock_recorded,
    'skipped', v_skipped,
    'errors', v_errors
  );
end;
$$;
