-- Storage bucket for slide image uploads.
-- Uploads happen via the service client (server action, gated by
-- requireDepartmentModerator), so the insert policy is belt-and-suspenders;
-- public read lets <img src> load the returned public URL.

insert into storage.buckets (id, name, public)
values ('slide-images', 'slide-images', true)
on conflict (id) do nothing;

drop policy if exists "Public read slide images" on storage.objects;
create policy "Public read slide images"
  on storage.objects for select
  using (bucket_id = 'slide-images');

drop policy if exists "Authenticated upload slide images" on storage.objects;
create policy "Authenticated upload slide images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'slide-images');
