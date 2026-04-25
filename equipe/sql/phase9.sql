-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 9
-- Réponse / citation, réactions emoji, accusés de lecture, mentions
-- =====================================================================

-- 1) Réponse / citation
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null;

-- 2) Réactions emoji
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.message_reactions enable row level security;

drop policy if exists "reactions readable by all authed" on public.message_reactions;
create policy "reactions readable by all authed"
  on public.message_reactions for select
  to authenticated using (true);

drop policy if exists "users insert own reactions" on public.message_reactions;
create policy "users insert own reactions"
  on public.message_reactions for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "users delete own reactions" on public.message_reactions;
create policy "users delete own reactions"
  on public.message_reactions for delete
  to authenticated using (auth.uid() = user_id);

-- 3) Accusés de lecture
create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reads enable row level security;

drop policy if exists "reads readable by all authed" on public.message_reads;
create policy "reads readable by all authed"
  on public.message_reads for select
  to authenticated using (true);

drop policy if exists "users insert own reads" on public.message_reads;
create policy "users insert own reads"
  on public.message_reads for insert
  to authenticated with check (auth.uid() = user_id);

-- 4) Activer realtime sur les nouvelles tables
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.message_reads;
