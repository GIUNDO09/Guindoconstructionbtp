-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 3
-- Arborescence de dossiers + fichiers (fichiers physiques stockés sur le PC)
-- À exécuter dans le SQL Editor de Supabase APRÈS init.sql et phase2.sql
-- =====================================================================

-- ---------- FOLDERS (hiérarchie de dossiers) ---------------------------
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  parent_id uuid references public.folders(id) on delete cascade,
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folders_parent_idx on public.folders(parent_id);

drop trigger if exists folders_set_updated_at on public.folders;
create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

-- ---------- FILES (métadonnées, fichier physique sur le PC) ------------
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  disk_filename text not null,            -- nom du fichier sur le disque du PC (uuid.ext)
  size_bytes bigint not null default 0,
  mime_type text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists files_folder_idx on public.files(folder_id);

-- ---------- RLS --------------------------------------------------------
alter table public.folders enable row level security;
alter table public.files   enable row level security;

-- Folders : membres voient tout, peuvent créer, modifier, supprimer
drop policy if exists folders_select on public.folders;
create policy folders_select on public.folders
  for select using (auth.role() = 'authenticated');

drop policy if exists folders_insert on public.folders;
create policy folders_insert on public.folders
  for insert with check (auth.role() = 'authenticated');

drop policy if exists folders_update on public.folders;
create policy folders_update on public.folders
  for update using (auth.role() = 'authenticated');

-- Seul l'admin peut supprimer un dossier (car cascade supprime les fichiers)
drop policy if exists folders_delete_admin on public.folders;
create policy folders_delete_admin on public.folders
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Files : membres voient tout, peuvent uploader (insert) ; suppression = uploader ou admin
drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (auth.role() = 'authenticated');

drop policy if exists files_insert on public.files;
create policy files_insert on public.files
  for insert with check (auth.uid() = uploaded_by);

drop policy if exists files_delete on public.files;
create policy files_delete on public.files
  for delete using (
    auth.uid() = uploaded_by
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ---------- APP_SETTINGS (clé/valeur partagée, ex. URL du serveur) -----
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select using (auth.role() = 'authenticated');

drop policy if exists app_settings_upsert_admin on public.app_settings;
create policy app_settings_upsert_admin on public.app_settings
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Realtime
alter publication supabase_realtime add table public.folders;
alter publication supabase_realtime add table public.files;
alter publication supabase_realtime add table public.app_settings;
