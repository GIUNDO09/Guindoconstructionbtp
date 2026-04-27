-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 13
-- Conversations privées (DM) en plus du canal général
--
-- Modèle :
--   - messages.conversation_id IS NULL  → canal général (rétrocompatible)
--   - messages.conversation_id = X     → DM avec les participants de X
-- =====================================================================

-- 1) Table des conversations
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('channel', 'dm')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 2) Participants (1 ligne par user pour les DMs)
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id)      on delete cascade,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conv_participants_user_idx
  on public.conversation_participants(user_id);

-- 3) Lien sur messages (NULL = canal général)
alter table public.messages
  add column if not exists conversation_id uuid
  references public.conversations(id) on delete cascade;

create index if not exists messages_conv_created_idx
  on public.messages(conversation_id, created_at desc);

-- 4) Helper SECURITY DEFINER pour éviter la récursion RLS
create or replace function public.is_dm_participant(conv_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = auth.uid()
  );
$$;
grant execute on function public.is_dm_participant(uuid) to authenticated;

-- 5) RLS — conversations
alter table public.conversations enable row level security;

drop policy if exists conv_select on public.conversations;
create policy conv_select on public.conversations
  for select using (
    type = 'channel' or public.is_dm_participant(id)
  );

drop policy if exists conv_insert on public.conversations;
create policy conv_insert on public.conversations
  for insert with check (auth.uid() = created_by);

-- 6) RLS — conversation_participants : on ne voit que les participations
--    des conversations auxquelles on participe (pas de fuite sociale).
alter table public.conversation_participants enable row level security;

drop policy if exists cp_select on public.conversation_participants;
create policy cp_select on public.conversation_participants
  for select using (
    user_id = auth.uid() or public.is_dm_participant(conversation_id)
  );

drop policy if exists cp_insert on public.conversation_participants;
create policy cp_insert on public.conversation_participants
  for insert with check (auth.role() = 'authenticated');

-- 7) RLS — messages : DM accessible aux participants
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    conversation_id is null or public.is_dm_participant(conversation_id)
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    auth.uid() = user_id
    and (
      conversation_id is null
      or public.is_dm_participant(conversation_id)
    )
  );

-- delete_own : déjà en place (auth.uid() = user_id), ne change pas

-- 8) Fonction "ouvre/crée le DM avec target_user"
create or replace function public.get_or_create_dm(target_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  conv_id uuid;
begin
  if me is null then
    raise exception 'Auth required';
  end if;
  if target_user is null or target_user = me then
    raise exception 'Invalid target user';
  end if;

  -- DM existant entre moi et target_user ?
  select c.id into conv_id
    from public.conversations c
    join public.conversation_participants p1
      on p1.conversation_id = c.id and p1.user_id = me
    join public.conversation_participants p2
      on p2.conversation_id = c.id and p2.user_id = target_user
   where c.type = 'dm'
   limit 1;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.conversations(type, created_by)
    values ('dm', me) returning id into conv_id;
  insert into public.conversation_participants(conversation_id, user_id)
    values (conv_id, me), (conv_id, target_user);
  return conv_id;
end$$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- 9) Realtime (idempotent)
do $$ begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.conversation_participants;
exception when duplicate_object then null; end $$;
