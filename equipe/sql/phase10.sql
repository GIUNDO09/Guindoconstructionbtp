-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 10
-- Web Push notifications (notifications hors-onglet)
-- =====================================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "users manage own push subs" on public.push_subscriptions;
create policy "users manage own push subs"
  on public.push_subscriptions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- service_role pourra tout lire (le pc-server l'utilise pour envoyer les pushes)
drop policy if exists "service role reads all subs" on public.push_subscriptions;
create policy "service role reads all subs"
  on public.push_subscriptions for select
  to service_role using (true);
drop policy if exists "service role deletes failed subs" on public.push_subscriptions;
create policy "service role deletes failed subs"
  on public.push_subscriptions for delete
  to service_role using (true);
