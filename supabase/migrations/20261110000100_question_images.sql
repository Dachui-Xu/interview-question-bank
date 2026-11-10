insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images', 'question-images', false, 6291456,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

create policy "Users upload their own question images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'question-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users read their own question images"
on storage.objects for select to authenticated
using (
  bucket_id = 'question-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
