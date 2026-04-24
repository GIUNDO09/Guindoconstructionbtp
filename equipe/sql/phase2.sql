-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 2
-- Chat d'équipe + commentaires sur tâches
-- À exécuter dans le SQL Editor du dashboard Supabase APRÈS init.sql
-- =====================================================================

-- ---------- MESSAGES (chat général) ------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) > 0 and char_length(content) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_created_at_idx on public.messages(created_at desc);

alter table public.messages enable row level security;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (auth.role() = 'authenticated');

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (auth.uid() = user_id);

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
  for delete using (auth.uid() = user_id);

-- ---------- TASK COMMENTS (fil par tâche) ------------------------------
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) > 0 and char_length(content) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists task_comments_task_idx on public.task_comments(task_id, created_at);

alter table public.task_comments enable row level security;

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select using (auth.role() = 'authenticated');

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
  for insert with check (auth.uid() = user_id);

drop policy if exists task_comments_delete_own on public.task_comments;
create policy task_comments_delete_own on public.task_comments
  for delete using (auth.uid() = user_id);

-- ---------- Activer Realtime sur les nouvelles tables ------------------
-- (Supabase active la publication supabase_realtime pour les tables ajoutées ici)
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.task_comments;
-- tasks est probablement déjà ajoutée, mais au cas où :
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;
