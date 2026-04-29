-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 18
-- Fix de la contrainte CHECK files_context_check :
-- ajoute 'task_proof' à la liste des contextes autorisés.
--
-- Oubli dans phase15 (preuves de réalisation) — sans cette migration,
-- l'upload d'une preuve échoue côté DB avec :
--   files_context_check violation
-- =====================================================================

alter table public.files drop constraint if exists files_context_check;
alter table public.files add constraint files_context_check
  check (context is null or context in ('chat', 'avatar', 'task', 'task_proof'));
