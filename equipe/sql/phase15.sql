-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 15
-- Preuve obligatoire pour valider une tâche
--
-- Quand un membre coche une tâche pour la marquer terminée, il doit
-- maintenant uploader au moins une preuve (photo, PDF, vidéo).
-- Les preuves sont stockées comme des files normaux mais avec :
--   - context = 'task_proof'
--   - task_proof_id = <task_id>
--   - sur disque : _taches/proofs/<task_id>/<fichier>
-- =====================================================================

-- 1) Nouvelle colonne task_proof_id sur files
alter table public.files
  add column if not exists task_proof_id uuid
  references public.tasks(id) on delete cascade;

create index if not exists files_task_proof_idx
  on public.files(task_proof_id)
  where task_proof_id is not null;

-- 1bis) Étendre la contrainte CHECK sur files.context pour autoriser
-- 'task_proof' (ajouté ici en avril 2026 — voir aussi phase18.sql qui
-- contient ce même fix isolé pour les installations existantes).
alter table public.files drop constraint if exists files_context_check;
alter table public.files add constraint files_context_check
  check (context is null or context in ('chat', 'avatar', 'task', 'task_proof'));

-- 2) Empêcher un membre de supprimer ses propres preuves (audit)
--    Seul l'admin peut supprimer une preuve. Les preuves sont aussi
--    auto-supprimées par CASCADE quand la tâche est supprimée.
drop policy if exists files_delete on public.files;
create policy files_delete on public.files
  for delete using (
    -- Tout fichier non-preuve : uploader OU admin (règle d'origine)
    (task_proof_id is null and (
       auth.uid() = uploaded_by
       or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    ))
    -- Fichier de preuve : admin uniquement
    or (task_proof_id is not null and
       exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  );
