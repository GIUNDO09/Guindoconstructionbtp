-- =====================================================================
-- GCBTP — Plateforme équipe — Schema initial
-- Phase 1 : profiles + tasks + RLS
-- À exécuter dans le SQL Editor du dashboard Supabase
-- =====================================================================

-- ---------- PROFILES ---------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'membre' check (role in ('admin','membre')),
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Auto-création d'un profil quand un user est créé dans auth.users
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'membre')
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- TASKS ------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  project text,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_assignee_idx on public.tasks(assignee_id);
create index if not exists tasks_status_idx on public.tasks(status);

-- Trigger pour updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------- RLS --------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.tasks    enable row level security;

-- PROFILES : tout user authentifié voit tous les profils de l'équipe.
-- Chaque user peut modifier son propre profil.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id);

-- TASKS : tous les membres authentifiés voient toutes les tâches.
-- Tous les membres peuvent créer et modifier (admin géré côté UI plus tard).
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (auth.role() = 'authenticated');

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (auth.role() = 'authenticated');

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (auth.role() = 'authenticated');

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (auth.role() = 'authenticated');
