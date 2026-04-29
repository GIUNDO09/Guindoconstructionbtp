-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 20
-- Backfill des contexts manquants sur public.files
--
-- Certains anciens uploads (vocaux du chat, avatars, fichiers tâches)
-- ont été créés avant que la colonne `context` soit systématiquement
-- renseignée par le serveur PC. Du coup ils apparaissaient dans la
-- racine de la page Fichiers (context IS NULL → matche le filtre).
--
-- Cette migration rattrape la colonne `context` à partir du chemin
-- disque réel (disk_filename), qui lui est toujours correct puisque
-- routé par le serveur.
-- =====================================================================

-- Vocaux + médias chat → context = 'chat'
update public.files
   set context = 'chat'
 where context is null
   and disk_filename like '_chat/%';

-- Avatars → context = 'avatar'
update public.files
   set context = 'avatar'
 where context is null
   and disk_filename like '_avatars/%';

-- Covers de tâches → context = 'task'
update public.files
   set context = 'task'
 where context is null
   and disk_filename like '_taches/%'
   and disk_filename not like '_taches/proofs/%';

-- Preuves de tâches → context = 'task_proof' (au cas où)
update public.files
   set context = 'task_proof'
 where context is null
   and disk_filename like '_taches/proofs/%';
