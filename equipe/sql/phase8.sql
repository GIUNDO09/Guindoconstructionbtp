-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 8
-- Étendre pièces jointes du chat (PDF / documents) + métadonnées
-- =====================================================================

-- 1) Remplacer la contrainte sur attachment_type pour ajouter 'document'
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.messages'::regclass
    and pg_get_constraintdef(oid) ilike '%attachment_type%';
  if cname is not null then
    execute format('alter table public.messages drop constraint %I', cname);
  end if;
end$$;

alter table public.messages
  add constraint messages_attachment_type_check
  check (attachment_type in ('image','video','audio','document'));

-- 2) Métadonnées pour afficher les documents (nom + taille) sans fetch auth
alter table public.messages
  add column if not exists attachment_name text,
  add column if not exists attachment_size bigint;
