-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 5
-- Profils enrichis : email perso, téléphone, titre, photo
-- =====================================================================

alter table public.profiles
  add column if not exists notification_email text,
  add column if not exists phone               text,
  add column if not exists title               text,
  add column if not exists avatar_file_id      uuid references public.files(id) on delete set null;

-- Note : la policy "profiles_update_self" déjà créée permet à chacun de
-- modifier son propre profil — pas besoin de la changer.
