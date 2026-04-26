-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 11
-- Profils enrichis : bio, liens, scores travail/assiduité, gains, historique
-- =====================================================================

-- 1) Nouvelles colonnes sur profiles
alter table public.profiles
  add column if not exists bio              text,
  add column if not exists description      text,
  add column if not exists portfolio_url    text,
  add column if not exists website_url      text,
  add column if not exists cv_url           text,
  add column if not exists linkedin_url     text,
  add column if not exists work_score       integer not null default 0,
  add column if not exists attendance_score integer not null default 0,
  add column if not exists total_earnings   numeric(14, 2) not null default 0;

-- Garde-fous
alter table public.profiles drop constraint if exists profiles_work_score_check;
alter table public.profiles add constraint profiles_work_score_check
  check (work_score between 0 and 100);

alter table public.profiles drop constraint if exists profiles_attendance_score_check;
alter table public.profiles add constraint profiles_attendance_score_check
  check (attendance_score between 0 and 100);

-- 2) Historique des scores (snapshot hebdo)
create table if not exists public.profile_score_history (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  work_score       integer,
  attendance_score integer,
  total_earnings   numeric(14, 2),
  recorded_at      date not null default current_date,
  notes            text
);

create unique index if not exists profile_score_history_user_date_uidx
  on public.profile_score_history(user_id, recorded_at);
create index if not exists profile_score_history_user_idx
  on public.profile_score_history(user_id);

-- 3) RLS
alter table public.profile_score_history enable row level security;

drop policy if exists "score history readable by all authed" on public.profile_score_history;
create policy "score history readable by all authed"
  on public.profile_score_history for select
  to authenticated using (true);

drop policy if exists "score history admin write" on public.profile_score_history;
create policy "score history admin write"
  on public.profile_score_history for insert
  to authenticated with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "score history service role write" on public.profile_score_history;
create policy "score history service role write"
  on public.profile_score_history for insert
  to service_role with check (true);

-- 4) Mise à jour des scores : seul l'admin peut écrire les colonnes scores/gains
--    (les colonnes bio/description/links restent éditables par le user lui-même
--     via la policy déjà en place sur profiles)
-- Note : on s'appuie sur la policy existante "users update own profile".
-- Pour empêcher un user de tricher sur ses propres scores via update direct :
-- on créera un trigger qui rejette si non-admin tente de modifier work_score / attendance_score / total_earnings.

create or replace function public.profiles_score_guard()
returns trigger language plpgsql security definer as $$
declare
  is_admin boolean;
begin
  select (role = 'admin') into is_admin from public.profiles where id = auth.uid();
  if coalesce(is_admin, false) then
    return new;
  end if;
  -- Empêcher le user de modifier ses scores ou gains
  if new.work_score       is distinct from old.work_score       then new.work_score       := old.work_score;       end if;
  if new.attendance_score is distinct from old.attendance_score then new.attendance_score := old.attendance_score; end if;
  if new.total_earnings   is distinct from old.total_earnings   then new.total_earnings   := old.total_earnings;   end if;
  return new;
end$$;

drop trigger if exists profiles_score_guard on public.profiles;
create trigger profiles_score_guard
  before update on public.profiles
  for each row execute function public.profiles_score_guard();

-- 5) Activer realtime sur l'historique
alter publication supabase_realtime add table public.profile_score_history;
