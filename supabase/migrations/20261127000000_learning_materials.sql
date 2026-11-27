create function private.valid_learning_material(kind text, doc jsonb)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare
  step jsonb;
begin
  if jsonb_typeof(doc) <> 'object'
    or not doc ?& array['title','company','author','source','body','steps']
    or jsonb_typeof(doc->'title') <> 'string' or char_length(btrim(doc->>'title')) not between 1 and 200
    or jsonb_typeof(doc->'company') <> 'string' or char_length(doc->>'company') > 120
    or jsonb_typeof(doc->'author') <> 'string' or char_length(doc->>'author') > 160
    or jsonb_typeof(doc->'source') <> 'string' or char_length(doc->>'source') > 2048
    or jsonb_typeof(doc->'body') <> 'string' or char_length(doc->>'body') > 120000
    or jsonb_typeof(doc->'steps') <> 'array' then return false;
  end if;
  if kind = 'experiences' then
    return jsonb_array_length(doc->'steps') = 0 and
      (btrim(doc->>'body') <> '' or btrim(doc->>'source') <> '');
  end if;
  if kind <> 'roadmaps' or jsonb_array_length(doc->'steps') not between 1 and 100 then return false; end if;
  for step in select value from jsonb_array_elements(doc->'steps') loop
    if jsonb_typeof(step) <> 'object' or not step ?& array['title','notes','topic','done']
      or jsonb_typeof(step->'title') <> 'string' or char_length(btrim(step->>'title')) not between 1 and 200
      or jsonb_typeof(step->'notes') <> 'string' or char_length(step->>'notes') > 30000
      or jsonb_typeof(step->'topic') <> 'string' or char_length(step->>'topic') > 2048
      or jsonb_typeof(step->'done') <> 'boolean' then return false;
    end if;
  end loop;
  return true;
end;
$$;

create table public.learning_materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('experiences', 'roadmaps')),
  content jsonb not null check (private.valid_learning_material(kind, content)),
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index learning_materials_owner_kind on public.learning_materials(owner_id, kind, created_at desc, id);
create trigger version_learning_materials before update of content on public.learning_materials
  for each row execute function private.bump_content_version();
alter table public.learning_materials enable row level security;
create policy own_learning_materials on public.learning_materials for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.learning_materials from public, anon, authenticated, service_role;
grant select, delete, insert (kind, content), update (content) on public.learning_materials to authenticated;
