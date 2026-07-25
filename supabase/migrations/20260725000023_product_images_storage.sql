-- Public-read bucket (images just render in <img> tags, nothing sensitive) with writes
-- restricted to the caller's own tenant via a path-prefix check, using the same
-- current_tenant_id() every other RLS policy uses. Object path convention:
-- {tenant_id}/{product_id}/{filename}. storage.foldername(name) is Supabase's built-in helper
-- that splits an object path into its folder segments; index [1] is the first segment (the
-- tenant_id prefix).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product_images_select_own_tenant"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
);

create policy "product_images_insert_own_tenant"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
);

create policy "product_images_update_own_tenant"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
);

create policy "product_images_delete_own_tenant"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
);
