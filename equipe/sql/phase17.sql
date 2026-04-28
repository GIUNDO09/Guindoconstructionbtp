-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 17
-- Vraie entité PROJET : remplace le champ texte tasks.project
--
-- - projects(id, name, description, client, location, dates, status,
--            cover_file_id, folder_id, created_by, created_at)
-- - project_members(project_id, user_id, role) : visibilité + auto-add
-- - tasks.project_id (FK) ; tasks.project (texte) gardé en denormalisé
--   pour compat
-- - conversations.project_id : conversation projet auto-créée
-- - Triggers : ajouter une tâche/affecter un membre = auto-join du
--   project_members ET de la project_conversation
-- =====================================================================

-- ---------- 1) Table projects -----------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  client        text,
  location      text,
  start_date    date,
  end_date      date,
  status        text not null default 'active'
                  check (status in ('active', 'done', 'on_hold', 'cancelled')),
  cover_file_id uuid references public.files(id)   on delete set null,
  folder_id     uuid references public.folders(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists projects_status_idx on public.projects(status);

-- ---------- 2) Table project_members ----------------------------------
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member'
              check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members(user_id);

-- ---------- 3) Helper SECURITY DEFINER (anti-récursion RLS) -----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_project_member(proj_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members
    where project_id = proj_id and user_id = auth.uid()
  );
$$;
grant execute on function public.is_project_member(uuid) to authenticated;

-- ---------- 4) tasks.project_id ---------------------------------------
alter table public.tasks
  add column if not exists project_id uuid
  references public.projects(id) on delete set null;

create index if not exists tasks_project_id_idx on public.tasks(project_id);

-- ---------- 5) conversations.project_id + extension du CHECK type -----
alter table public.conversations
  add column if not exists project_id uuid
  references public.projects(id) on delete cascade;

alter table public.conversations drop constraint if exists conversations_type_check;
alter table public.conversations add constraint conversations_type_check
  check (type in ('channel', 'dm', 'project'));

create index if not exists conversations_project_id_idx
  on public.conversations(project_id) where project_id is not null;

-- ---------- 6) MIGRATION : créer projects + lier tasks ----------------
do $$
declare
  rec record;
  proj_id uuid;
  admin_id uuid;
begin
  select id into admin_id from public.profiles where role = 'admin' limit 1;

  for rec in
    select distinct trim(project) as name
    from public.tasks
    where project is not null and trim(project) <> ''
  loop
    select id into proj_id from public.projects where name = rec.name limit 1;
    if proj_id is null then
      insert into public.projects (name, created_by, status)
      values (rec.name, admin_id, 'active')
      returning id into proj_id;
    end if;
    update public.tasks set project_id = proj_id where trim(project) = rec.name;
  end loop;
end $$;

-- ---------- 7) Backfill project_members depuis task_assignees ---------
insert into public.project_members (project_id, user_id, role)
select distinct t.project_id, ta.user_id, 'member'
from public.task_assignees ta
join public.tasks t on t.id = ta.task_id
where t.project_id is not null
on conflict do nothing;

-- Le créateur (admin) devient owner sur les projets qu'il a créés
insert into public.project_members (project_id, user_id, role)
select p.id, p.created_by, 'owner'
from public.projects p
where p.created_by is not null
on conflict (project_id, user_id) do update set role = 'owner';

-- ---------- 8) Trigger : auto-add project member quand on assigne -----
create or replace function public.auto_add_to_project_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members (project_id, user_id, role)
  select t.project_id, NEW.user_id, 'member'
  from public.tasks t
  where t.id = NEW.task_id and t.project_id is not null
  on conflict do nothing;
  return NEW;
end; $$;

drop trigger if exists task_assignees_add_to_project_members on public.task_assignees;
create trigger task_assignees_add_to_project_members
  after insert on public.task_assignees
  for each row execute function public.auto_add_to_project_members();

-- ---------- 9) Trigger : auto-join project conversation ---------------
create or replace function public.auto_add_to_project_conv()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.conversation_participants (conversation_id, user_id)
  select c.id, NEW.user_id
  from public.conversations c
  join public.tasks t on t.id = NEW.task_id
  where c.type = 'project' and c.project_id = t.project_id
  on conflict do nothing;
  return NEW;
end; $$;

drop trigger if exists task_assignees_add_to_project_conv on public.task_assignees;
create trigger task_assignees_add_to_project_conv
  after insert on public.task_assignees
  for each row execute function public.auto_add_to_project_conv();

-- ---------- 10) RLS sur projects --------------------------------------
alter table public.projects enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (public.is_admin() or public.is_project_member(id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert with check (public.is_admin());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (public.is_admin());

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete using (public.is_admin());

-- ---------- 11) RLS sur project_members -------------------------------
alter table public.project_members enable row level security;

drop policy if exists pm_select on public.project_members;
create policy pm_select on public.project_members
  for select using (
    public.is_admin()
    or user_id = auth.uid()
    or public.is_project_member(project_id)
  );

drop policy if exists pm_insert on public.project_members;
create policy pm_insert on public.project_members
  for insert with check (public.is_admin());

drop policy if exists pm_delete on public.project_members;
create policy pm_delete on public.project_members
  for delete using (public.is_admin());

-- ---------- 12) Mise à jour RLS conversations pour inclure 'project' --
-- La policy existante sur conversations couvre déjà 'channel' (toujours
-- visible) et le check is_dm_participant pour les autres types.
-- 'project' tombera dans la même branche que 'dm' (visible aux participants).

-- ---------- 13) RPC : créer un projet (avec dossier + conversation) ---
create or replace function public.create_project_with_setup(
  p_name        text,
  p_description text default null,
  p_client      text default null,
  p_location    text default null,
  p_start_date  date default null,
  p_end_date    date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me            uuid := auth.uid();
  new_project   uuid;
  new_folder    uuid;
  new_conv      uuid;
begin
  if me is null then raise exception 'Auth required'; end if;
  if not public.is_admin() then raise exception 'Admin uniquement'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Nom requis'; end if;

  -- 1) Crée le dossier racine pour les fichiers du projet
  insert into public.folders (name, parent_id, status)
  values (trim(p_name), null, 'in_progress')
  returning id into new_folder;

  -- 2) Crée le projet
  insert into public.projects (
    name, description, client, location,
    start_date, end_date, folder_id, created_by, status
  ) values (
    trim(p_name), p_description, p_client, p_location,
    p_start_date, p_end_date, new_folder, me, 'active'
  ) returning id into new_project;

  -- 3) Ajoute l'admin comme owner
  insert into public.project_members (project_id, user_id, role)
  values (new_project, me, 'owner');

  -- 4) Crée la conversation projet (admin seul participant initial)
  insert into public.conversations (type, created_by, project_id)
  values ('project', me, new_project)
  returning id into new_conv;

  insert into public.conversation_participants (conversation_id, user_id)
  values (new_conv, me);

  return new_project;
end$$;
grant execute on function public.create_project_with_setup(text, text, text, text, date, date) to authenticated;

-- ---------- 14) Realtime ----------------------------------------------
do $$ begin alter publication supabase_realtime add table public.projects; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.project_members; exception when duplicate_object then null; end $$;
