create schema if not exists private;

create function private.valid_question(content jsonb)
returns boolean language plpgsql immutable strict set search_path = '' as $$
begin
  if jsonb_typeof(content) <> 'object'
    or not (content ?& array['category','recruitment','topic','prompt','answer','company','source','tags','notes'])
    or content - array['category','recruitment','topic','prompt','answer','company','source','tags','notes'] <> '{}'::jsonb
    or jsonb_typeof(content->'tags') <> 'array'
  then
    return false;
  end if;

  return jsonb_typeof(content->'category') = 'string'
    and content->>'category' in ('written', 'interview')
    and jsonb_typeof(content->'recruitment') = 'string'
    and content->>'recruitment' in ('campus', 'experienced', 'unspecified')
    and jsonb_typeof(content->'topic') = 'string'
    and char_length(content->>'topic') <= 160
    and jsonb_typeof(content->'prompt') = 'string'
    and char_length(btrim(content->>'prompt')) between 1 and 12000
    and jsonb_typeof(content->'answer') = 'string'
    and char_length(content->>'answer') <= 24000
    and jsonb_typeof(content->'company') = 'string'
    and char_length(content->>'company') <= 120
    and jsonb_typeof(content->'source') = 'string'
    and char_length(content->>'source') <= 2048
    and jsonb_typeof(content->'notes') = 'string'
    and char_length(content->>'notes') <= 12000
    and jsonb_array_length(content->'tags') <= 20
    and not exists (
      select from jsonb_array_elements(content->'tags') as tag(value)
      where jsonb_typeof(value) <> 'string'
        or char_length(btrim(value #>> '{}')) not between 1 and 40
    );
end;
$$;

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content jsonb not null check (private.valid_question(content)),
  mastery text check (mastery in ('known', 'unsure', 'unknown')),
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table public.question_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content jsonb not null check (private.valid_question(content)),
  question_id uuid,
  base_version integer,
  base_content jsonb check (private.valid_question(base_content)),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  check (
    (question_id is null and base_version is null and base_content is null)
    or (question_id is not null and base_version is not null and base_content is not null)
  )
);

create index questions_owner_created on public.questions(owner_id, created_at desc, id);
create index drafts_owner_created on public.question_drafts(owner_id, created_at desc, id);

create function private.bump_content_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.content is distinct from old.content then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger version_questions before update of content on public.questions
  for each row execute function private.bump_content_version();
create trigger version_drafts before update of content on public.question_drafts
  for each row execute function private.bump_content_version();

alter table public.questions enable row level security;
alter table public.question_drafts enable row level security;

create policy own_questions on public.questions for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy own_drafts on public.question_drafts for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.questions, public.question_drafts from public, anon, authenticated, service_role;
grant select, delete on public.questions, public.question_drafts to authenticated;
grant insert (content), update (content, mastery) on public.questions to authenticated;
grant insert (content), update (content) on public.question_drafts to authenticated;
grant select on public.questions to service_role;
grant insert (owner_id, content, question_id, base_version, base_content),
  select on public.question_drafts to service_role;

create function public.approve_question_draft(
  draft_id uuid,
  expected_version integer,
  approved_content jsonb
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  draft public.question_drafts;
  saved_id uuid;
begin
  select * into draft from public.question_drafts
    where id = draft_id and owner_id = (select auth.uid()) for update;
  if not found or draft.version <> expected_version then
    raise exception 'draft_changed';
  end if;

  if draft.question_id is null then
    insert into public.questions (content) values (approved_content) returning id into saved_id;
  else
    update public.questions set content = approved_content
      where id = draft.question_id and owner_id = (select auth.uid())
        and version = draft.base_version returning id into saved_id;
    if not found then
      raise exception 'question_changed';
    end if;
  end if;

  delete from public.question_drafts where id = draft.id;
  return saved_id;
end;
$$;

revoke all on function public.approve_question_draft(uuid, integer, jsonb) from public, anon, service_role;
grant execute on function public.approve_question_draft(uuid, integer, jsonb) to authenticated;
