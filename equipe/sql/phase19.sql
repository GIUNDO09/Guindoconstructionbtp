-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 19
-- Workflow de validation des preuves de réalisation par l'admin.
--
-- Avant phase19 : dès qu'un membre upload sa preuve, la tâche passe en
-- 'done'. L'admin n'a qu'une option : rejeter pour remettre en cours.
-- Aucune trace explicite de l'acceptation.
--
-- Après phase19 : la tâche passe toujours en 'done' à l'upload, mais
-- elle est "en attente de validation admin" tant que proof_validated_at
-- est null. L'admin peut alors :
--   - Valider     → proof_validated_at = now(), proof_validated_by = admin
--   - Rejeter     → status = 'in_progress', proof_validated_* = null
-- =====================================================================

alter table public.tasks
  add column if not exists proof_validated_at timestamptz,
  add column if not exists proof_validated_by uuid
    references public.profiles(id) on delete set null;

create index if not exists tasks_proof_pending_idx
  on public.tasks(status)
  where status = 'done' and proof_validated_at is null;
