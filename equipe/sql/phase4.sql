-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 4
-- Tâches enrichies : plusieurs assignés + image de couverture + dossier lié
-- =====================================================================

-- 1) Colonnes supplémentaires sur tasks
alter table public.tasks
  add column if not exists cover_file_id uuid references public.files(id)  on delete set null;

alter table public.tasks
  add column if not exists folder_id uuid references public.folders(id) on delete set null;

-- 2) Table de liaison : plusieurs assignés par tâche
create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (task_id, user_id)
);

create index if not exists task_assignees_user_idx on public.task_assignees(user_id);

-- 3) Migration : copier les assignee_id existants dans la nouvelle table
insert into public.task_assignees (task_id, user_id)
  select id, assignee_id from public.tasks where assignee_id is not null
  on conflict do nothing;

-- 4) RLS sur task_assignees : tous les membres voient, tous peuvent modifier
alter table public.task_assignees enable row level security;

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees
  for select using (auth.role() = 'authenticated');

drop policy if exists task_assignees_insert on public.task_assignees;
create policy task_assignees_insert on public.task_assignees
  for insert with check (auth.role() = 'authenticated');

drop policy if exists task_assignees_delete on public.task_assignees;
create policy task_assignees_delete on public.task_assignees
  for delete using (auth.role() = 'authenticated');

-- 5) Realtime (idempotent)
do $$ begin alter publication supabase_realtime add table public.task_assignees; exception when duplicate_object then null; end $$;
