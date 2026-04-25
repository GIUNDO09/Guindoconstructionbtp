-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 7
-- Pièces jointes dans le chat (images, vidéos, audio)
-- =====================================================================

alter table public.messages
  add column if not exists attachment_file_id uuid references public.files(id) on delete set null,
  add column if not exists attachment_type    text check (attachment_type in ('image','video','audio'));

-- Permettre messages vides quand il y a une pièce jointe
-- (le check existant impose char_length(content) > 0, on l'assouplit)
alter table public.messages
  drop constraint if exists messages_content_check;

alter table public.messages
  add constraint messages_content_check
  check (
    (attachment_file_id is not null) or (char_length(content) between 1 and 2000)
  );

-- Idempotent : le caption peut maintenant être vide ou jusqu'à 2000 caractères
alter table public.messages
  alter column content drop not null;
