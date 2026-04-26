-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 12
-- Classement automatique des médias par contexte (chat / avatar / task)
-- =====================================================================

-- Nouvelle colonne sur files : permet de séparer les fichiers projet
-- (visibles dans la page Fichiers) des fichiers système (avatars, médias chat,
-- couvertures de tâches) qui restent invisibles côté Fichiers mais référencés
-- par leur entité respective.
alter table public.files
  add column if not exists context text;

-- Valeurs autorisées : null (fichier projet normal) | 'chat' | 'avatar' | 'task'
alter table public.files drop constraint if exists files_context_check;
alter table public.files add constraint files_context_check
  check (context is null or context in ('chat', 'avatar', 'task'));

-- Index pour requêter rapidement les fichiers projet (page Fichiers)
create index if not exists files_no_context_idx
  on public.files(folder_id) where context is null;
