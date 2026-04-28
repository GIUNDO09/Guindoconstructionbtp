-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 16
-- Célébration automatique de fin de projet
--
-- Quand toutes les tâches d'un projet (champ tasks.project) passent
-- au statut "done", le notifier (côté pc-server) poste un message de
-- félicitations dans le canal général + push à toute l'équipe.
--
-- Cette table sert d'anti-doublon : on ne célèbre qu'une fois.
-- Si une tâche du projet revient en non-done (édition, nouvelle tâche
-- ajoutée, etc.), la ligne est supprimée → le projet est "ré-armé"
-- pour une future célébration.
-- =====================================================================

create table if not exists public.project_celebrations (
  project       text primary key,
  celebrated_at timestamptz not null default now(),
  task_count    integer not null
);

alter table public.project_celebrations enable row level security;

drop policy if exists pc_select on public.project_celebrations;
create policy pc_select on public.project_celebrations
  for select using (auth.role() = 'authenticated');

-- Pas de policies INSERT/DELETE : seul le service role (notifier)
-- écrit dans cette table — il bypass RLS par design.

-- REPLICA IDENTITY FULL sur tasks : pour que les events DELETE realtime
-- exposent le champ "project" (sinon p.old ne contient que l'id).
-- Le notifier en a besoin pour savoir quel projet ré-évaluer après une suppression.
alter table public.tasks replica identity full;
