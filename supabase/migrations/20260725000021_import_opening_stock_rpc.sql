-- Batch opening-stock import. Called once per CSV upload with every structurally-valid row
-- (already Zod-validated in the Route Handler -- types, required fields, known-unit-key shape,
-- within-file duplicate-barcode check) as a single jsonb array, avoiding 1000+ sequential
-- network round-trips from the Route Handler (which would blow Vercel's execution ceiling).
--
-- Each row's work is wrapped in a nested BEGIN...EXCEPTION block, which creates an implicit
-- SAVEPOINT per iteration in plpgsql: one bad row (e.g. a business-rule violation the JS pass
-- couldn't catch, like a duplicate barcode against an *existing* product) rolls back only that
-- row's writes and is recorded as an error, while the rest of the batch commits. This is what
-- makes "1000+ rows without failure" mean "the whole import doesn't die because of one bad row."
--
-- Idempotent re-upload: a barcode match reuses the existing product (never fuzzy-matched by
-- name -- too risky, could silently merge two different products) and, if that product already
-- has opening stock recorded, the row is reported as "skipped," not double-counted (also
-- enforced at the DB level by the partial unique index on stock_ledger). A row with
-- opening_quantity = 0 still creates the product but skips the ledger insert (stock_ledger's
-- quantity_delta <> 0 check exists to prevent no-op ledger noise).
--
-- Expected row shape (already validated shape-wise by the caller):
-- { row, name_en, name_ur, category_name, brand, barcode, stock_unit_key,
--   purchase_unit_key, purchase_to_stock_factor, sale_unit_key, sale_to_stock_factor,
--   tax_rate_bps, reorder_level, opening_quantity, unit_cost_paisa }
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
      -- Resolve or create category by name (case-insensitive, top-level only -- an import can't
      -- target a subcategory, keeps this simple and matches the common case).
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

      -- stock_unit is required and must already exist for this tenant.
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

-- service_role only -- same lockdown pattern as bootstrap_tenant. Revoking from PUBLIC alone is
-- not enough (see ENGINEERING.md's SECURITY DEFINER grant gotcha, which applies to any function here
-- regardless of SECURITY DEFINER/INVOKER -- Supabase's default privileges grant EXECUTE to
-- anon/authenticated separately).
revoke execute on function public.import_opening_stock(uuid, uuid, jsonb) from public;
revoke execute on function public.import_opening_stock(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.import_opening_stock(uuid, uuid, jsonb) to service_role;
