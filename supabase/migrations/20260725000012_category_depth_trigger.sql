-- Caps category nesting at 2 levels (top-level + optional subcategory, e.g. "Beverages > Soft
-- Drinks") and prevents cross-tenant parent linkage. The cross-tenant check matters specifically
-- because all writes go through the service-role admin client (bypasses RLS) -- RLS alone would
-- not stop a buggy app-code path from linking a category to a parent in a different tenant.
create or replace function public.enforce_category_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_tenant_id uuid;
  v_parent_parent_id uuid;
begin
  if new.parent_category_id is null then
    return new;
  end if;

  if new.parent_category_id = new.id then
    raise exception 'A category cannot be its own parent';
  end if;

  select tenant_id, parent_category_id
    into v_parent_tenant_id, v_parent_parent_id
    from public.categories
    where id = new.parent_category_id;

  if v_parent_tenant_id is null then
    raise exception 'Parent category not found';
  end if;

  if v_parent_tenant_id is distinct from new.tenant_id then
    raise exception 'Parent category must belong to the same tenant';
  end if;

  if v_parent_parent_id is not null then
    raise exception 'Categories can only be nested 2 levels deep';
  end if;

  return new;
end;
$$;

-- Revoking from PUBLIC alone is not enough -- Supabase's default privileges separately grant
-- EXECUTE to anon/authenticated on every new function (the gotcha documented in AGENTS.md).
revoke execute on function public.enforce_category_depth() from public;
revoke execute on function public.enforce_category_depth() from anon, authenticated;

create trigger trg_enforce_category_depth
before insert or update on public.categories
for each row execute function public.enforce_category_depth();
