-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 21
-- Appels audio/vidéo style WhatsApp (ringing → accept/decline → active)
--
-- L'appelant insère une ligne dans `calls` avec status='ringing'. Tous
-- les autres participants de la conversation (ou tous les profils si
-- conversation_id is null = canal général) reçoivent un event Realtime
-- → modal d'appel entrant + sonnerie. Acceptation = update status.
-- =====================================================================

create table if not exists public.calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  caller_id       uuid not null references public.profiles(id) on delete cascade,
  audio_only      boolean not null default false,
  room_url        text not null,
  status          text not null default 'ringing'
                  check (status in ('ringing', 'active', 'ended', 'declined', 'missed', 'cancelled')),
  started_at      timestamptz not null default now(),
  answered_by     uuid references public.profiles(id) on delete set null,
  answered_at     timestamptz,
  ended_at        timestamptz
);

create index if not exists calls_conversation_idx
  on public.calls(conversation_id, started_at desc);
create index if not exists calls_active_idx
  on public.calls(status)
  where status in ('ringing', 'active');

alter table public.calls enable row level security;

-- SELECT : participants de la conversation, ou tout authentifié pour canal général
drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
  for select using (
    conversation_id is null
    or public.is_dm_participant(conversation_id)
  );

-- INSERT : seul l'appelant peut créer un appel à son nom
drop policy if exists calls_insert on public.calls;
create policy calls_insert on public.calls
  for insert with check (
    caller_id = auth.uid()
    and (
      conversation_id is null
      or public.is_dm_participant(conversation_id)
    )
  );

-- UPDATE : l'appelant (annuler) ou un participant (accepter/refuser/ending)
drop policy if exists calls_update on public.calls;
create policy calls_update on public.calls
  for update using (
    caller_id = auth.uid()
    or conversation_id is null
    or public.is_dm_participant(conversation_id)
  );

-- Realtime
do $$ begin
  alter publication supabase_realtime add table public.calls;
exception when duplicate_object then null; end $$;
