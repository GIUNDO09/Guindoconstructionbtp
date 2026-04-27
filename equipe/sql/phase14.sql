-- =====================================================================
-- GCBTP — Plateforme équipe — Phase 14
-- Messages épinglés (canal général + DMs)
--
-- Règles :
--   - Canal général (conversation_id IS NULL) : seul un admin peut épingler
--   - DM : tout participant de la conversation peut épingler
--   - Limite : max 3 messages épinglés par conversation
-- =====================================================================

-- 1) Colonnes pinned_at / pinned_by sur messages
alter table public.messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.profiles(id) on delete set null;

-- Index pour récupérer rapidement les épinglés d'une conv
create index if not exists messages_pinned_idx
  on public.messages(conversation_id, pinned_at desc)
  where pinned_at is not null;

-- 2) RPC toggle_pin(message_id, do_pin)
create or replace function public.toggle_pin(msg_id uuid, do_pin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  msg        record;
  me         uuid := auth.uid();
  is_admin   boolean;
  pin_count  int;
begin
  if me is null then
    raise exception 'Auth required';
  end if;

  select id, conversation_id, pinned_at into msg
    from public.messages where id = msg_id;
  if msg.id is null then
    raise exception 'Message not found';
  end if;

  -- Vérification de permission selon le contexte
  if msg.conversation_id is null then
    -- Canal général : admin uniquement
    select (role = 'admin') into is_admin
      from public.profiles where id = me;
    if not coalesce(is_admin, false) then
      raise exception 'Seul un admin peut épingler dans le canal général';
    end if;
  else
    -- DM : participant uniquement
    if not public.is_dm_participant(msg.conversation_id) then
      raise exception 'Tu n''es pas participant de cette conversation';
    end if;
  end if;

  if do_pin then
    -- Si déjà épinglé : noop
    if msg.pinned_at is not null then return; end if;
    -- Limite : max 3 par conv
    if msg.conversation_id is null then
      select count(*) into pin_count from public.messages
       where pinned_at is not null and conversation_id is null;
    else
      select count(*) into pin_count from public.messages
       where pinned_at is not null and conversation_id = msg.conversation_id;
    end if;
    if pin_count >= 3 then
      raise exception 'Limite atteinte (3 messages max). Désépingle un message d''abord.';
    end if;
    update public.messages
       set pinned_at = now(), pinned_by = me
     where id = msg_id;
  else
    update public.messages
       set pinned_at = null, pinned_by = null
     where id = msg_id;
  end if;
end$$;

grant execute on function public.toggle_pin(uuid, boolean) to authenticated;

-- 3) Realtime — déjà actif sur messages, mais s'assurer que les UPDATE
--    sur pinned_at/pinned_by sont propagés (REPLICA IDENTITY)
alter table public.messages replica identity full;
