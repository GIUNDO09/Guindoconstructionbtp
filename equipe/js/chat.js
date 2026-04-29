(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

let me = null;
let profilesById = {};
let serverUrl = null;
let pendingAttachment = null;          // { file, type } en attente d'envoi
let mediaRecorder = null;
let recordChunks = [];
let recordStartTime = 0;
let recordTimer = null;
const blobUrlCache = new Map();        // fileId → blob URL (pour images/audio/video)
let chatChannel = null;                // canal Supabase (realtime + broadcast)
const typingUsers = new Map();         // user_id → { name, expiresAt }
let typingRenderTimer = null;
let lastTypingSentAt = 0;
let lastSeenDayKey = null;             // pour insérer les séparateurs de date
let pendingReply = null;               // { id, author, preview }
const messageCache = new Map();        // id → message (pour citations)
const reactionsByMessage = new Map();  // message_id → Map(emoji → Set<user_id>)
const readsByMessage = new Map();      // message_id → Set<user_id>
let pickerTargetMessageId = null;
let mentionState = null;               // { start, query } pour autocomplete

// Conversations : null = canal général, sinon UUID d'un DM
let currentConversationId = null;
let conversations = [];                // [{ id, type, otherUserId, ... }]
let participantsByConv = {};           // conv_id → [user_id, ...]

(async () => {
  const session = await requireAuth();
  if (!session) return;

  bindUI();

  me = await currentProfile();
  document.getElementById('userName').textContent = me?.full_name || session.user.email;

  await loadProfiles();
  await loadServerUrl();
  await loadConversations();
  renderConvSidebar();

  // ?dm=<user_id> dans l'URL → ouvre/crée le DM, sinon canal général par défaut
  const params = new URLSearchParams(location.search);
  const dmTarget = params.get('dm');
  let openedFromUrl = false;
  if (dmTarget && dmTarget !== me?.id) {
    try {
      const { data: convId } = await sb.rpc('get_or_create_dm', { target_user: dmTarget });
      if (convId) {
        await loadConversations();
        renderConvSidebar();
        await switchConversation(convId);
        history.replaceState(null, '', 'chat.html');
        openedFromUrl = true;
      }
    } catch (e) { console.warn('DM auto-open échoué:', e.message); }
  }
  if (!openedFromUrl) await switchConversation(null);

  chatChannel = sb.channel('messages-realtime', {
      config: {
        broadcast: { self: false },
        presence: { key: me?.id || 'anon' }
      }
    })
    .on('presence', { event: 'sync' }, () => renderOnlineCount())
    .on('presence', { event: 'join' }, () => renderOnlineCount())
    .on('presence', { event: 'leave' }, () => renderOnlineCount())
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        const msg = payload.new;
        const convId = msg.conversation_id || null;
        if (convId === currentConversationId) {
          appendMessage(msg, true);
          notifyIfNeeded(msg);
          markVisibleAsRead();
        } else {
          // Message dans une autre conversation : notif + bump de la sidebar
          notifyIfNeeded(msg);
          loadConversations().then(renderConvSidebar);
        }
      }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => removeMessage(payload.old.id)
    )
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload) => {
        const m = payload.new;
        if ((m.conversation_id || null) !== currentConversationId) return;
        // Met à jour le cache + réaffiche le badge "épinglé" sur la bulle
        messageCache.set(m.id, m);
        const el = document.querySelector(`.msg[data-id="${m.id}"] .msg-bubble`);
        if (el) {
          const flag = el.querySelector('.msg-pinned-flag');
          if (m.pinned_at && !flag) {
            const span = document.createElement('span');
            span.className = 'msg-pinned-flag';
            span.innerHTML = '<i data-lucide="pin"></i> Épinglé';
            el.prepend(span);
          } else if (!m.pinned_at && flag) {
            flag.remove();
          }
          // Met à jour le bouton pin (icône + état)
          const btn = el.querySelector('.msg-act-pin');
          if (btn) {
            btn.innerHTML = `<i data-lucide="${m.pinned_at ? 'pin-off' : 'pin'}"></i>`;
            btn.title = m.pinned_at ? 'Désépingler' : 'Épingler';
            btn.dataset.pinned = m.pinned_at ? '1' : '0';
          }
          window.gcbtp?.renderIcons?.();
        }
        loadPinnedForCurrentConv();
      }
    )
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'conversations' },
      () => loadConversations().then(renderConvSidebar)
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: 'key=eq.file_server_url' },
      async () => { serverUrl = await window.gcbtp.cache.getServerUrl({ refresh: true }); }
    )
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'message_reactions' },
      (p) => { applyReactionDelta(p.new, +1); renderReactionsFor(p.new.message_id); }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'message_reactions' },
      (p) => { applyReactionDelta(p.old, -1); renderReactionsFor(p.old.message_id); }
    )
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'message_reads' },
      (p) => { addRead(p.new.message_id, p.new.user_id); renderTicksFor(p.new.message_id); }
    )
    .on('broadcast', { event: 'typing' }, (msg) => {
      const { user_id, name } = msg.payload || {};
      if (!user_id || user_id === me?.id) return;
      typingUsers.set(user_id, { name: name || 'Quelqu\'un', expiresAt: Date.now() + 4000 });
      renderTyping();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await chatChannel.track({
          user_id: me?.id,
          name: me?.full_name || 'Inconnu',
          online_at: new Date().toISOString()
        });
      }
    });

  // Marquer comme lu quand la fenêtre est active
  window.addEventListener('focus', markVisibleAsRead);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) markVisibleAsRead(); });
})();

async function loadServerUrl() {
  serverUrl = await window.gcbtp.cache.getServerUrl();
}

function notifyIfNeeded(m) {
  if (m.user_id === me?.id) return;
  const author = profilesById[m.user_id]?.full_name || 'Quelqu\'un';
  const mentioned = isMentioned(m.content);
  const isDm = !!m.conversation_id;
  const preview = (mentioned ? '🔔 ' : '') + previewText(m);
  window.gcbtp?.notif?.chime();
  // Dans une autre conv que la courante OU document caché OU mentionné → notif
  const otherConv = (m.conversation_id || null) !== currentConversationId;
  if (document.hidden || !document.hasFocus() || mentioned || otherConv) {
    const prefix = mentioned ? '🔔 ' : (isDm ? '📩 ' : '💬 ');
    const suffix = mentioned ? " t'a mentionné" : '';
    const title = `${prefix}${author}${suffix}`;
    const tag = isDm ? `gcbtp-dm-${m.conversation_id}` : 'gcbtp-chat';
    const notif = window.gcbtp?.notif?.show(title, preview, { tag });
    if (notif) notif.onclick = () => { window.focus(); notif.close(); };
  }
}

function previewText(m) {
  if (m.attachment_type === 'image') return '📷 Image' + (m.content ? ` — ${m.content}` : '');
  if (m.attachment_type === 'video') return '🎞️ Vidéo' + (m.content ? ` — ${m.content}` : '');
  if (m.attachment_type === 'audio') return '🎤 Message vocal';
  if (m.attachment_type === 'document') return '📎 ' + (m.attachment_name || 'Document');
  return (m.content || '').slice(0, 80);
}

async function loadProfiles() {
  const data = await window.gcbtp.cache.getProfiles();
  profilesById = Object.fromEntries((data || []).map(p => [p.id, p]));
}

// -----------------------------------------------------------
// Conversations (DMs)
// -----------------------------------------------------------
async function loadConversations() {
  const [{ data: convs }, { data: parts }] = await Promise.all([
    sb.from('conversations').select('*').eq('type', 'dm'),
    sb.from('conversation_participants').select('*')
  ]);
  participantsByConv = {};
  (parts || []).forEach(p => {
    (participantsByConv[p.conversation_id] ||= []).push(p.user_id);
  });
  const meId = me?.id;
  conversations = (convs || []).map(c => {
    const ids = participantsByConv[c.id] || [];
    return { ...c, otherUserId: ids.find(id => id !== meId) || null };
  });
  // Tri : le plus récent en haut (à terme : par dernier message)
  conversations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function renderConvSidebar() {
  const list = document.getElementById('convList');
  if (!list) return;
  const generalActive = currentConversationId === null;
  const generalHtml = `
    <button type="button" class="conv-item ${generalActive ? 'conv-item-active' : ''}" data-conv-id="">
      <div class="conv-avatar conv-avatar-channel">💬</div>
      <div class="conv-body">
        <div class="conv-name">Canal général</div>
        <div class="conv-sub">Toute l'équipe</div>
      </div>
    </button>`;
  const dmsHtml = conversations.map(c => {
    const other = profilesById[c.otherUserId];
    const name = other?.full_name || 'Conversation';
    const sub  = other?.title || 'Conversation privée';
    const active = c.id === currentConversationId ? 'conv-item-active' : '';
    return `
      <button type="button" class="conv-item ${active}" data-conv-id="${c.id}">
        <div class="conv-avatar" data-avatar-user="${c.otherUserId || ''}">${escapeHtml(initialsOf(name))}</div>
        <div class="conv-body">
          <div class="conv-name">${escapeHtml(name)}</div>
          <div class="conv-sub">${escapeHtml(sub)}</div>
        </div>
      </button>`;
  }).join('');
  list.innerHTML = generalHtml + dmsHtml;
  // Hydrate avatars (image authentifiée si dispo)
  list.querySelectorAll('[data-avatar-user]').forEach(el => {
    const uid = el.dataset.avatarUser;
    const profile = uid && profilesById[uid];
    if (profile?.avatar_file_id && serverUrl) {
      loadAvatarThumb(el, profile.avatar_file_id);
    }
  });
  window.gcbtp?.renderIcons?.();
}

async function loadAvatarThumb(slot, fileId) {
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) return;
    const r = await fetch(`${serverUrl}/stream/${fileId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.alt = '';
    slot.textContent = '';
    slot.appendChild(img);
  } catch {}
}

async function switchConversation(convId) {
  if (convId === '' || convId === undefined) convId = null;
  currentConversationId = convId;

  // Titre + sous-titre
  const titleEl = document.getElementById('chatTitle');
  const subEl = document.getElementById('chatSubText');
  if (convId === null) {
    titleEl.textContent = '💬 Canal général';
    subEl.textContent = "Discussion en temps réel avec toute l'équipe";
  } else {
    const conv = conversations.find(c => c.id === convId);
    const other = conv && profilesById[conv.otherUserId];
    titleEl.textContent = other?.full_name ? `💬 ${other.full_name}` : '💬 Conversation';
    subEl.textContent = other?.title || 'Conversation privée';
  }

  // Active dans la sidebar
  document.querySelectorAll('.conv-item').forEach(el => {
    const id = el.dataset.convId || '';
    el.classList.toggle('conv-item-active', id === (convId || ''));
  });

  // Mobile : bascule la vue sur le panneau de chat
  document.getElementById('chatMain').classList.add('with-conv');

  // Reset de l'état des messages
  document.getElementById('messagesList').innerHTML = '';
  messageCache.clear();
  reactionsByMessage.clear();
  readsByMessage.clear();
  lastSeenDayKey = null;
  cancelReply();

  await Promise.all([loadMessages(), loadPinnedForCurrentConv()]);
}

function initialsOf(s) {
  const parts = String(s || '').trim().split(/\s+/);
  if (!parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function openNewConvModal() {
  const modal = document.getElementById('newConvModal');
  if (!modal) return;
  document.getElementById('newConvSearch').value = '';
  renderNewConvMembers('');
  modal.hidden = false;
}
function closeNewConvModal() {
  document.getElementById('newConvModal').hidden = true;
}

function renderNewConvMembers(query) {
  const list = document.getElementById('newConvMembers');
  if (!list) return;
  const q = (query || '').trim().toLowerCase();
  const others = Object.values(profilesById)
    .filter(p => p.id !== me?.id)
    .filter(p => !q || (p.full_name || '').toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q))
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  list.innerHTML = others.map(p => `
    <button type="button" class="new-conv-member" data-user-id="${p.id}">
      <div class="conv-avatar" data-avatar-user="${p.id}">${escapeHtml(initialsOf(p.full_name))}</div>
      <div class="conv-body">
        <div class="conv-name">${escapeHtml(p.full_name || 'Sans nom')}</div>
        <div class="conv-sub">${escapeHtml(p.title || '')}</div>
      </div>
    </button>`).join('') || '<p class="form-hint">Aucun membre.</p>';
  list.querySelectorAll('[data-avatar-user]').forEach(el => {
    const profile = profilesById[el.dataset.avatarUser];
    if (profile?.avatar_file_id && serverUrl) loadAvatarThumb(el, profile.avatar_file_id);
  });
  window.gcbtp?.renderIcons?.();
}

async function startDmWith(userId) {
  if (!userId || userId === me?.id) return;
  try {
    const { data: convId, error } = await sb.rpc('get_or_create_dm', { target_user: userId });
    if (error) throw error;
    await loadConversations();
    renderConvSidebar();
    closeNewConvModal();
    await switchConversation(convId);
  } catch (e) {
    alert('Impossible de démarrer la conversation : ' + e.message);
  }
}

// -----------------------------------------------------------
// Messages épinglés
// -----------------------------------------------------------
function canPinHere() {
  // Canal général : admin uniquement. DM : tout participant (= moi puisque je vois la conv).
  if (currentConversationId === null) return me?.role === 'admin';
  return true;
}

async function loadPinnedForCurrentConv() {
  let q = sb.from('messages').select('*').not('pinned_at', 'is', null);
  q = currentConversationId
    ? q.eq('conversation_id', currentConversationId)
    : q.is('conversation_id', null);
  q = q.order('pinned_at', { ascending: false }).limit(3);
  const { data, error } = await q;
  if (error) { console.warn('loadPinned:', error.message); return; }
  renderPinned(data || []);
}

function renderPinned(items) {
  const bar = document.getElementById('pinnedBar');
  const list = document.getElementById('pinnedList');
  const countEl = document.getElementById('pinnedCount');
  if (!bar || !list) return;
  if (!items.length) {
    bar.hidden = true;
    list.innerHTML = '';
    return;
  }
  bar.hidden = false;
  countEl.textContent = items.length;
  const canUnpin = canPinHere();
  list.innerHTML = items.map(m => {
    const author = profilesById[m.user_id]?.full_name || 'Inconnu';
    const preview = previewText(m).slice(0, 200) || '—';
    const unpinBtn = canUnpin
      ? `<button type="button" class="pinned-item-unpin" data-unpin-id="${m.id}" title="Désépingler"><i data-lucide="x"></i></button>`
      : '';
    return `
      <div class="pinned-item" data-jump-id="${m.id}">
        <div class="pinned-item-body">
          <div class="pinned-item-author">${escapeHtml(author)}</div>
          <div class="pinned-item-text">${escapeHtml(preview)}</div>
        </div>
        ${unpinBtn}
      </div>`;
  }).join('');
  // Mémorise pour les realtime UPDATE
  items.forEach(m => messageCache.set(m.id, m));
  window.gcbtp?.renderIcons?.();
}

async function togglePin(messageId, doPin) {
  try {
    const { error } = await sb.rpc('toggle_pin', { msg_id: messageId, do_pin: doPin });
    if (error) throw error;
  } catch (e) {
    alert(e.message || 'Action impossible');
  }
}

async function loadMessages() {
  let q = sb.from('messages').select('*')
    .order('created_at', { ascending: true }).limit(200);
  q = currentConversationId
    ? q.eq('conversation_id', currentConversationId)
    : q.is('conversation_id', null);
  const { data, error } = await q;
  if (error) { console.error(error); return; }
  const list = document.getElementById('messagesList');
  list.innerHTML = '';
  lastSeenDayKey = null;
  messageCache.clear();
  (data || []).forEach(m => messageCache.set(m.id, m));

  // Charger réactions et lectures en parallèle
  const ids = (data || []).map(m => m.id);
  if (ids.length > 0) {
    const [{ data: rx }, { data: rd }] = await Promise.all([
      sb.from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids),
      sb.from('message_reads').select('message_id, user_id').in('message_id', ids),
    ]);
    (rx || []).forEach(r => applyReactionDelta(r, +1));
    (rd || []).forEach(r => addRead(r.message_id, r.user_id));
  }

  (data || []).forEach(m => appendMessage(m, false));
  scrollToBottom();
  markVisibleAsRead();
}

function dayKeyOf(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function formatDayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dayKeyOf(date) === dayKeyOf(today)) return 'Aujourd\'hui';
  if (dayKeyOf(date) === dayKeyOf(yesterday)) return 'Hier';
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('fr-FR', sameYear
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}
function maybeInsertDaySeparator(list, msgDate) {
  const key = dayKeyOf(msgDate);
  if (key === lastSeenDayKey) return;
  lastSeenDayKey = key;
  const sep = document.createElement('div');
  sep.className = 'msg-day-sep';
  sep.innerHTML = `<span>${formatDayLabel(msgDate)}</span>`;
  list.appendChild(sep);
}

function appendMessage(m, animate) {
  const list = document.getElementById('messagesList');
  if (list.querySelector(`[data-id="${m.id}"]`)) return;
  const created = new Date(m.created_at);
  maybeInsertDaySeparator(list, created);
  messageCache.set(m.id, m);

  const mine = m.user_id === me?.id;
  const author = profilesById[m.user_id]?.full_name || 'Inconnu';
  const when = created.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = `msg ${mine ? 'msg-mine' : ''} ${animate ? 'msg-new' : ''}`;
  div.dataset.id = m.id;

  let attachmentHtml = '';
  if (m.attachment_file_id && m.attachment_type) {
    const fid = m.attachment_file_id;
    if (m.attachment_type === 'image') {
      attachmentHtml = `<div class="msg-media msg-media-image"><img data-media-id="${fid}" data-action="zoom" alt="image"></div>`;
    } else if (m.attachment_type === 'video') {
      attachmentHtml = `<div class="msg-media"><video data-media-id="${fid}" controls playsinline preload="metadata"></video></div>`;
    } else if (m.attachment_type === 'audio') {
      attachmentHtml = `
        <div class="msg-audio-player">
          <button type="button" class="msa-play" aria-label="Lire"><i data-lucide="play"></i></button>
          <div class="msa-track" role="slider" aria-label="Position de lecture" tabindex="0">
            <div class="msa-progress"></div>
          </div>
          <span class="msa-time">0:00</span>
          <button type="button" class="msa-speed" aria-label="Vitesse de lecture">1x</button>
          <audio data-media-id="${fid}" preload="metadata"></audio>
        </div>`;
    } else if (m.attachment_type === 'document') {
      const name = escapeHtml(m.attachment_name || 'Document');
      const size = formatBytes(m.attachment_size);
      const icon = docIcon(m.attachment_name);
      attachmentHtml = `
        <a href="#" class="msg-doc" data-doc-id="${fid}" data-doc-name="${name}" download>
          <span class="msg-doc-icon">${icon}</span>
          <span class="msg-doc-info">
            <span class="msg-doc-name">${name}</span>
            <span class="msg-doc-meta">${size}</span>
          </span>
          <span class="msg-doc-dl"><i data-lucide="download"></i></span>
        </a>`;
    }
  }

  // Citation (réponse à un autre message)
  let quoteHtml = '';
  if (m.reply_to_id) {
    const q = messageCache.get(m.reply_to_id);
    if (q) {
      const qAuthor = profilesById[q.user_id]?.full_name || 'Inconnu';
      const qPreview = previewText(q).slice(0, 120);
      quoteHtml = `<div class="msg-quote" data-jump-id="${q.id}">
        <span class="msg-quote-bar"></span>
        <div class="msg-quote-body">
          <span class="msg-quote-author">${escapeHtml(qAuthor)}</span>
          <span class="msg-quote-text">${escapeHtml(qPreview)}</span>
        </div>
      </div>`;
    } else {
      quoteHtml = `<div class="msg-quote msg-quote-missing"><em>Message supprimé</em></div>`;
    }
  }

  const contentHtml = m.content
    ? `<div class="msg-content">${renderMessageContent(m.content)}</div>`
    : '';

  const pinnedFlag = m.pinned_at
    ? `<span class="msg-pinned-flag"><i data-lucide="pin"></i> Épinglé</span>`
    : '';
  const canPin = canPinHere();
  const pinBtn = canPin
    ? `<button type="button" class="msg-act msg-act-pin" title="${m.pinned_at ? 'Désépingler' : 'Épingler'}" data-id="${m.id}" data-pinned="${m.pinned_at ? '1' : '0'}"><i data-lucide="${m.pinned_at ? 'pin-off' : 'pin'}"></i></button>`
    : '';

  div.innerHTML = `
    <div class="msg-bubble">
      ${pinnedFlag}
      <div class="msg-head">
        <a class="msg-author" href="profil-public.html?id=${m.user_id}">${escapeHtml(author)}</a>
        <span class="msg-time">${when}</span>
      </div>
      ${quoteHtml}
      ${attachmentHtml}
      ${contentHtml}
      <div class="msg-footer">
        <div class="msg-reactions" data-msg="${m.id}"></div>
        ${mine ? `<span class="msg-ticks" data-msg="${m.id}"><i data-lucide="check"></i></span>` : ''}
      </div>
      <div class="msg-actions">
        <button type="button" class="msg-act msg-act-react" title="Réagir" data-id="${m.id}"><i data-lucide="smile-plus"></i></button>
        <button type="button" class="msg-act msg-act-reply" title="Répondre" data-id="${m.id}"><i data-lucide="reply"></i></button>
        ${m.attachment_type === 'audio' ? `<button type="button" class="msg-act msg-act-totask" title="Convertir en tâche" data-id="${m.id}"><i data-lucide="clipboard-list"></i></button>` : ''}
        ${pinBtn}
        ${mine ? `<button class="msg-act msg-delete" title="Supprimer" data-id="${m.id}"><i data-lucide="trash-2"></i></button>` : ''}
      </div>
    </div>`;
  list.appendChild(div);

  // Hydrater les médias avec auth
  div.querySelectorAll('[data-media-id]').forEach(el => loadAuthedMedia(el, el.dataset.mediaId));
  // Activer le lecteur audio custom
  div.querySelectorAll('.msg-audio-player').forEach(setupAudioPlayer);
  // Réactions et accusés de lecture
  renderReactionsFor(m.id);
  if (mine) renderTicksFor(m.id);
  window.gcbtp?.renderIcons?.();
  scrollToBottom();
}

function setupAudioPlayer(player) {
  const audio = player.querySelector('audio');
  const playBtn = player.querySelector('.msa-play');
  const track = player.querySelector('.msa-track');
  const progress = player.querySelector('.msa-progress');
  const timeEl = player.querySelector('.msa-time');

  const fmt = (t) => {
    if (!isFinite(t) || t < 0) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const render = () => {
    const cur = audio.currentTime || 0;
    const dur = isFinite(audio.duration) ? audio.duration : 0;
    progress.style.width = dur > 0 ? `${(cur / dur) * 100}%` : '0%';
    timeEl.textContent = cur > 0 ? `${fmt(cur)} / ${fmt(dur)}` : fmt(dur);
  };

  audio.addEventListener('loadedmetadata', render);
  audio.addEventListener('timeupdate', render);
  audio.addEventListener('play', () => {
    playBtn.innerHTML = '<i data-lucide="pause"></i>';
    playBtn.setAttribute('aria-label', 'Pause');
    player.classList.add('msa-playing');
    window.gcbtp?.renderIcons?.();
  });
  audio.addEventListener('pause', () => {
    playBtn.innerHTML = '<i data-lucide="play"></i>';
    playBtn.setAttribute('aria-label', 'Lire');
    player.classList.remove('msa-playing');
    window.gcbtp?.renderIcons?.();
  });
  audio.addEventListener('ended', () => {
    audio.currentTime = 0;
    progress.style.width = '0%';
  });

  playBtn.addEventListener('click', () => {
    // Pause les autres lecteurs en cours
    document.querySelectorAll('.msg-audio-player audio').forEach(a => {
      if (a !== audio && !a.paused) a.pause();
    });
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });

  track.addEventListener('click', (e) => {
    const dur = audio.duration;
    if (!isFinite(dur) || dur === 0) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * dur;
  });

  // Vitesse de lecture (cycle 1x → 1.5x → 2x → 1x), persistée en localStorage
  const speedBtn = player.querySelector('.msa-speed');
  if (speedBtn) {
    const SPEEDS = [1, 1.5, 2];
    const stored = parseFloat(localStorage.getItem('gcbtp_audio_speed') || '1');
    let idx = SPEEDS.indexOf(stored);
    if (idx < 0) idx = 0;
    const apply = (rate) => {
      audio.playbackRate = rate;
      speedBtn.textContent = (rate === 1 ? '1x' : `${rate}x`);
    };
    apply(SPEEDS[idx]);
    audio.addEventListener('loadedmetadata', () => apply(SPEEDS[idx]));
    speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      idx = (idx + 1) % SPEEDS.length;
      const r = SPEEDS[idx];
      localStorage.setItem('gcbtp_audio_speed', String(r));
      // Appliquer à tous les lecteurs ouverts (cohérence visuelle)
      document.querySelectorAll('.msg-audio-player').forEach(p => {
        const a = p.querySelector('audio');
        const b = p.querySelector('.msa-speed');
        if (a) a.playbackRate = r;
        if (b) b.textContent = (r === 1 ? '1x' : `${r}x`);
      });
    });
  }
}

async function loadAuthedMedia(el, fileId) {
  if (!serverUrl || !fileId) return;
  if (blobUrlCache.has(fileId)) {
    el.src = blobUrlCache.get(fileId);
    return;
  }
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) return;
    const r = await fetch(`${serverUrl}/stream/${fileId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    blobUrlCache.set(fileId, url);
    el.src = url;
  } catch (e) {
    console.warn('Media load failed:', e.message);
    el.parentElement?.classList.add('msg-media-error');
  }
}

function removeMessage(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
}

function scrollToBottom() {
  const list = document.getElementById('messagesList');
  list.scrollTop = list.scrollHeight;
}

// -----------------------------------------------------------
// UI
// -----------------------------------------------------------
function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Sidebar des conversations : clic sur un item → bascule
  document.getElementById('convList').addEventListener('click', async (e) => {
    const item = e.target.closest('.conv-item');
    if (!item) return;
    const id = item.dataset.convId || null;
    if (id === currentConversationId) {
      // Sur mobile : juste bascule la vue sur le panneau
      document.getElementById('chatMain').classList.add('with-conv');
      return;
    }
    await switchConversation(id);
  });

  // Bouton "nouvelle conversation"
  document.getElementById('newConvBtn').addEventListener('click', openNewConvModal);
  document.getElementById('newConvClose').addEventListener('click', closeNewConvModal);
  document.getElementById('newConvModal').addEventListener('click', (e) => {
    if (e.target.id === 'newConvModal') closeNewConvModal();
  });
  document.getElementById('newConvSearch').addEventListener('input', (e) => {
    renderNewConvMembers(e.target.value);
  });
  document.getElementById('newConvMembers').addEventListener('click', async (e) => {
    const btn = e.target.closest('.new-conv-member');
    if (!btn) return;
    await startDmWith(btn.dataset.userId);
  });

  // Bouton retour (mobile uniquement) : montre la sidebar
  document.getElementById('convBackBtn').addEventListener('click', () => {
    document.getElementById('chatMain').classList.remove('with-conv');
  });

  // Démarrer une visio / appel vocal : sonnerie chez les autres via table calls
  document.getElementById('startVisioBtn').addEventListener('click', startVisio);
  document.getElementById('startCallBtn').addEventListener('click', startVoiceCall);

  // Modals d'appel : accepter / refuser / annuler
  document.getElementById('incomingCallAccept').addEventListener('click', acceptIncomingCall);
  document.getElementById('incomingCallDecline').addEventListener('click', declineIncomingCall);
  document.getElementById('outgoingCallCancel').addEventListener('click', cancelOutgoingCall);

  // Abonnement Realtime aux appels entrants
  subscribeCalls();

  // Modal Jitsi : fermer
  document.getElementById('jitsiCloseBtn').addEventListener('click', closeJitsiModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('jitsiModal').hidden) closeJitsiModal();
  });

  // Barre des épinglés : toggle, clic pour sauter, désépingler
  document.getElementById('pinnedToggle').addEventListener('click', () => {
    const bar = document.getElementById('pinnedBar');
    bar.classList.toggle('collapsed');
    const expanded = !bar.classList.contains('collapsed');
    document.getElementById('pinnedToggle').setAttribute('aria-expanded', String(expanded));
  });
  document.getElementById('pinnedList').addEventListener('click', async (e) => {
    const unpin = e.target.closest('.pinned-item-unpin');
    if (unpin) {
      e.stopPropagation();
      await togglePin(unpin.dataset.unpinId, false);
      return;
    }
    const item = e.target.closest('.pinned-item[data-jump-id]');
    if (item) jumpToMessage(item.dataset.jumpId);
  });

  // Bouton notifications
  const notifBtn = document.getElementById('enableNotifBtn');
  if ('Notification' in window) {
    if (Notification.permission === 'default') notifBtn.hidden = false;
    notifBtn.addEventListener('click', async () => {
      const ok = await window.gcbtp.notif.requestPermission();
      if (ok) {
        notifBtn.hidden = true;
        window.gcbtp.notif.chime();
        window.gcbtp.notif.show('✅ Notifications activées', 'Tu seras alerté(e) des nouveaux messages.');
      }
    });
  }

  // Form submit (texte ou avec pièce jointe en attente)
  const form = document.getElementById('chatForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await sendMessage();
  });

  const chatInput = document.getElementById('chatInput');
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  // Auto-grow du textarea (style WhatsApp)
  const autoGrow = () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
  };
  chatInput.addEventListener('input', () => {
    autoGrow();
    sendTypingPing();
    updateMentionPicker();
  });
  chatInput.addEventListener('blur', () => {
    setTimeout(() => { document.getElementById('mentionPicker').hidden = true; }, 150);
  });

  // Picker mentions : clic sur un nom
  document.getElementById('mentionPicker').addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button[data-user]');
    if (!btn) return;
    e.preventDefault();
    const profile = profilesById[btn.dataset.user];
    if (profile) applyMention(profile);
  });

  // Réponse — annulation
  document.getElementById('cancelReply').addEventListener('click', cancelReply);

  // Lightbox image (clic sur image → plein écran)
  document.getElementById('messagesList').addEventListener('click', (e) => {
    const img = e.target.closest('img[data-action="zoom"]');
    if (!img) return;
    e.preventDefault();
    const fid = img.dataset.mediaId;
    const src = img.src || (fid && blobUrlCache.get(fid));
    if (src) openLightbox(src);
  });

  // Clic sur "Rejoindre la réunion" dans un message → ouvre Jitsi
  document.getElementById('messagesList').addEventListener('click', (e) => {
    const btn = e.target.closest('.msg-jitsi-join');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    openJitsiModal(btn.dataset.jitsiUrl);
  });

  // Clic sur le nom d'auteur ou une mention → page profil public
  document.getElementById('messagesList').addEventListener('click', (e) => {
    const author = e.target.closest('.msg-author');
    if (author && author.href) {
      e.preventDefault();
      window.location.href = author.href;
      return;
    }
    const mention = e.target.closest('.mention[data-user]');
    if (mention) {
      e.preventDefault();
      window.location.href = `profil-public.html?id=${mention.dataset.user}`;
    }
  });

  const lightbox = document.getElementById('lightbox');
  lightbox.addEventListener('click', (e) => {
    // Ferme si clic sur le fond, le bouton ✕, ou l'image elle-même
    if (e.target.closest('.lightbox-download')) return;
    closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });

  // Actions sur les messages : répondre, réagir, supprimer, sauter à citation, toggle réaction existante
  document.getElementById('messagesList').addEventListener('click', async (e) => {
    // Sauter à la citation
    const quote = e.target.closest('.msg-quote[data-jump-id]');
    if (quote) { jumpToMessage(quote.dataset.jumpId); return; }

    // Toggle réaction existante (clic sur la pastille)
    const rxBtn = e.target.closest('.msg-rx');
    if (rxBtn) {
      e.stopPropagation();
      toggleReaction(rxBtn.dataset.msg, rxBtn.dataset.emoji);
      return;
    }

    // Réagir (ouvre le picker)
    const reactBtn = e.target.closest('.msg-act-react');
    if (reactBtn) { e.stopPropagation(); openReactionPicker(reactBtn.dataset.id, reactBtn); return; }

    // Répondre
    const replyBtn = e.target.closest('.msg-act-reply');
    if (replyBtn) { startReply(replyBtn.dataset.id); return; }

    // Convertir un message vocal en tâche
    const toTaskBtn = e.target.closest('.msg-act-totask');
    if (toTaskBtn) {
      e.stopPropagation();
      const msg = messageCache.get(toTaskBtn.dataset.id);
      if (!msg) return;
      const author = profilesById[msg.user_id]?.full_name || 'Inconnu';
      sessionStorage.setItem('gcbtp_pending_task_from_voice', JSON.stringify({
        msgId: msg.id,
        author,
        content: msg.content || '',
        createdAt: msg.created_at
      }));
      window.location.href = 'dashboard.html';
      return;
    }

    // Épingler / désépingler
    const pinBtn = e.target.closest('.msg-act-pin');
    if (pinBtn) {
      e.stopPropagation();
      const willPin = pinBtn.dataset.pinned !== '1';
      await togglePin(pinBtn.dataset.id, willPin);
      return;
    }

    // Supprimer
    const delBtn = e.target.closest('.msg-delete');
    if (delBtn) {
      if (!confirm('Supprimer ce message ?')) return;
      const { data: msg } = await sb.from('messages').select('attachment_file_id').eq('id', delBtn.dataset.id).single();
      if (msg?.attachment_file_id && serverUrl) {
        const token = (await sb.auth.getSession()).data.session?.access_token;
        await fetch(`${serverUrl}/file/${msg.attachment_file_id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => {});
      } else {
        await sb.from('messages').delete().eq('id', delBtn.dataset.id);
      }
      return;
    }
  });

  // Picker emoji — clic sur un emoji
  document.getElementById('reactionPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-emoji]');
    if (!btn || !pickerTargetMessageId) return;
    toggleReaction(pickerTargetMessageId, btn.dataset.emoji);
    closeReactionPicker();
  });
  // Fermer le picker au clic en dehors
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('reactionPicker');
    if (picker.hidden) return;
    if (!picker.contains(e.target) && !e.target.closest('.msg-act-react')) closeReactionPicker();
  });

  // Pièce jointe : sélection fichier
  document.getElementById('attachBtn').addEventListener('click', () => {
    document.getElementById('attachInput').click();
  });
  document.getElementById('attachInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const type = file.type.startsWith('image/') ? 'image'
                : file.type.startsWith('video/') ? 'video'
                : file.type.startsWith('audio/') ? 'audio'
                : 'document';
    if (file.size > 100 * 1024 * 1024) { alert('Fichier trop volumineux (max 100 Mo)'); return; }
    pendingAttachment = { file, type };
    showAttachmentPreview();
  });

  // Photo directe via la caméra (ouvre l'app caméra sur mobile, le picker sur desktop)
  document.getElementById('cameraBtn').addEventListener('click', () => {
    document.getElementById('cameraInput').click();
  });
  document.getElementById('cameraInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { alert('Photo trop volumineuse (max 100 Mo)'); return; }
    pendingAttachment = { file, type: 'image' };
    showAttachmentPreview();
    e.target.value = '';
  });

  // Téléchargement document (clic tuile)
  document.getElementById('messagesList').addEventListener('click', async (e) => {
    const a = e.target.closest('.msg-doc');
    if (!a) return;
    e.preventDefault();
    const fid = a.dataset.docId;
    const name = a.dataset.docName || 'document';
    if (!fid || !serverUrl) return;
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      const r = await fetch(`${serverUrl}/stream/${fid}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      alert('Téléchargement impossible : ' + err.message);
    }
  });

  // Recherche
  document.getElementById('searchToggleBtn').addEventListener('click', () => toggleSearch(true));
  document.getElementById('searchClose').addEventListener('click', () => toggleSearch(false));
  document.getElementById('searchInput').addEventListener('input', (e) => filterMessages(e.target.value));

  document.getElementById('cancelAttachment').addEventListener('click', () => {
    pendingAttachment = null;
    document.getElementById('attachInput').value = '';
    hideAttachmentPreview();
  });

  // Vocal : démarrer l'enregistrement
  document.getElementById('recBtn').addEventListener('click', startRecording);
  document.getElementById('recCancel').addEventListener('click', cancelRecording);
  document.getElementById('recStop').addEventListener('click', stopAndSendRecording);
}

function showAttachmentPreview() {
  if (!pendingAttachment) return;
  const t = pendingAttachment.type;
  const icon = t === 'image' ? '📷' : t === 'video' ? '🎞️' : t === 'audio' ? '🎵' : docIcon(pendingAttachment.file.name);
  document.getElementById('attachmentName').textContent =
    `${icon} ${pendingAttachment.file.name} (${formatBytes(pendingAttachment.file.size)})`;
  document.getElementById('attachmentPreview').hidden = false;
}
function hideAttachmentPreview() {
  document.getElementById('attachmentPreview').hidden = true;
}

async function sendMessage() {
  if (!me) return;
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content && !pendingAttachment) return;

  input.disabled = true;
  let attachmentFileId = null;
  let attachmentType = null;

  // 1. Upload de la pièce jointe via le serveur PC
  if (pendingAttachment) {
    if (!serverUrl) {
      alert('Serveur PC non configuré — impossible d\'envoyer de pièce jointe');
      input.disabled = false;
      return;
    }
    try {
      const token = (await sb.auth.getSession()).data.session.access_token;
      const fd = new FormData();
      fd.append('file', pendingAttachment.file);
      fd.append('context', 'chat');
      const r = await fetch(`${serverUrl}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      if (!r.ok) throw new Error(await r.text());
      const { file } = await r.json();
      attachmentFileId = file.id;
      attachmentType = pendingAttachment.type;
    } catch (err) {
      alert('Échec de l\'envoi : ' + err.message);
      input.disabled = false;
      return;
    }
  }

  // 2. Insert du message
  const insertRow = {
    user_id: me.id,
    content: content || null,
    attachment_file_id: attachmentFileId,
    attachment_type: attachmentType,
    conversation_id: currentConversationId  // null = canal général
  };
  if (pendingAttachment) {
    insertRow.attachment_name = pendingAttachment.file.name;
    insertRow.attachment_size = pendingAttachment.file.size;
  }
  if (pendingReply) insertRow.reply_to_id = pendingReply.id;
  const { error } = await sb.from('messages').insert(insertRow);
  if (!error) cancelReply();

  input.value = '';
  input.style.height = 'auto';
  input.disabled = false;
  input.focus();
  pendingAttachment = null;
  document.getElementById('attachInput').value = '';
  hideAttachmentPreview();

  if (error) alert('Erreur: ' + error.message);
}

// -----------------------------------------------------------
// Enregistrement vocal
// -----------------------------------------------------------
async function startRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunks.push(e.data); };
    mediaRecorder.onstop = () => stream.getTracks().forEach(t => t.stop());
    mediaRecorder.start();
    recordStartTime = Date.now();
    document.getElementById('recordingBar').hidden = false;
    document.getElementById('recBtn').disabled = true;
    recordTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - recordStartTime) / 1000);
      document.getElementById('recDuration').textContent =
        `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }, 200);
  } catch (err) {
    alert('Impossible d\'accéder au micro : ' + err.message);
  }
}

function cancelRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.onstop = (e) => mediaRecorder.stream?.getTracks().forEach(t => t.stop());
    mediaRecorder.stop();
  }
  cleanupRecordingUI();
}

async function stopAndSendRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  document.getElementById('recStop').disabled = true;
  mediaRecorder.onstop = async () => {
    mediaRecorder.stream?.getTracks().forEach(t => t.stop());
    const blob = new Blob(recordChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    const ext = (mediaRecorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
    const file = new File([blob], `vocal-${Date.now()}.${ext}`, { type: blob.type });
    pendingAttachment = { file, type: 'audio' };
    cleanupRecordingUI();
    await sendMessage();
  };
  mediaRecorder.stop();
}

function cleanupRecordingUI() {
  document.getElementById('recordingBar').hidden = true;
  document.getElementById('recBtn').disabled = false;
  document.getElementById('recStop').disabled = false;
  if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
}

// -----------------------------------------------------------
// Lightbox image
// -----------------------------------------------------------
function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.querySelector('.lightbox-img').src = src;
  const dl = lb.querySelector('.lightbox-download');
  if (dl) dl.href = src;
  lb.hidden = false;
  document.body.classList.add('no-scroll');
}
function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.hidden = true;
  lb.querySelector('.lightbox-img').removeAttribute('src');
  document.body.classList.remove('no-scroll');
}

// -----------------------------------------------------------
// Présence (utilisateurs en ligne dans le chat)
// -----------------------------------------------------------
function renderOnlineCount() {
  const indicator = document.getElementById('onlineIndicator');
  const countEl = document.getElementById('onlineCount');
  if (!indicator || !countEl || !chatChannel) return;
  const state = chatChannel.presenceState();
  // Une "key" peut avoir plusieurs sessions (multi-onglets), on compte les keys uniques
  const keys = Object.keys(state || {});
  const count = keys.length;
  countEl.textContent = count;
  // Tooltip : noms des présents
  const names = keys.map(k => {
    const arr = state[k];
    return arr?.[0]?.name || profilesById[k]?.full_name || 'Inconnu';
  });
  indicator.title = names.length ? names.join(', ') : 'Aucune présence détectée';
  indicator.classList.toggle('online-empty', count === 0);
}

// -----------------------------------------------------------
// Indicateur "X est en train d'écrire…"
// -----------------------------------------------------------
function sendTypingPing() {
  if (!chatChannel || !me) return;
  const now = Date.now();
  if (now - lastTypingSentAt < 1500) return; // throttle
  lastTypingSentAt = now;
  chatChannel.send({
    type: 'broadcast',
    event: 'typing',
    payload: { user_id: me.id, name: me.full_name || 'Quelqu\'un' }
  });
}

function renderTyping() {
  const el = document.getElementById('typingIndicator');
  const txt = document.getElementById('typingText');
  if (!el || !txt) return;
  const now = Date.now();
  // purge expirés
  for (const [uid, info] of typingUsers) {
    if (info.expiresAt < now) typingUsers.delete(uid);
  }
  const names = [...typingUsers.values()].map(v => v.name);
  if (names.length === 0) {
    el.hidden = true;
  } else {
    let label;
    if (names.length === 1) label = `${names[0]} écrit…`;
    else if (names.length === 2) label = `${names[0]} et ${names[1]} écrivent…`;
    else label = `${names.length} personnes écrivent…`;
    txt.textContent = label;
    el.hidden = false;
  }
  if (typingRenderTimer) clearTimeout(typingRenderTimer);
  if (typingUsers.size > 0) typingRenderTimer = setTimeout(renderTyping, 800);
}

// -----------------------------------------------------------
// Recherche
// -----------------------------------------------------------
function toggleSearch(open) {
  const bar = document.getElementById('searchBar');
  const input = document.getElementById('searchInput');
  bar.hidden = !open;
  if (open) { input.focus(); }
  else { input.value = ''; filterMessages(''); }
}

function filterMessages(query) {
  const q = (query || '').trim().toLowerCase();
  const list = document.getElementById('messagesList');
  const messages = list.querySelectorAll('.msg');
  let matchCount = 0;
  messages.forEach(div => {
    if (!q) {
      div.hidden = false;
      const c = div.querySelector('.msg-content');
      if (c && c.dataset.original) { c.innerHTML = c.dataset.original; delete c.dataset.original; }
      return;
    }
    const text = (div.textContent || '').toLowerCase();
    const hit = text.includes(q);
    div.hidden = !hit;
    if (hit) matchCount++;
    // Surligner dans .msg-content
    const c = div.querySelector('.msg-content');
    if (c) {
      if (!c.dataset.original) c.dataset.original = c.innerHTML;
      const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
      c.innerHTML = c.dataset.original.replace(/<mark>|<\/mark>/g, '').replace(/(>)([^<]+)(<)/g, (_, a, b, z) => a + b.replace(re, '<mark>$1</mark>') + z);
    }
  });
  // Cacher aussi les séparateurs orphelins
  list.querySelectorAll('.msg-day-sep').forEach(s => s.hidden = !!q);
  document.getElementById('searchCount').textContent = q ? `${matchCount} résultat${matchCount > 1 ? 's' : ''}` : '';
}

// -----------------------------------------------------------
// Documents — helpers
// -----------------------------------------------------------
function formatBytes(n) {
  if (!n || n < 0) return '';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
}
function docIcon(name) {
  const ext = (name || '').toLowerCase().split('.').pop();
  if (ext === 'pdf') return '📕';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  if (['txt', 'md'].includes(ext)) return '📄';
  return '📎';
}

// -----------------------------------------------------------
// Réponse / citation
// -----------------------------------------------------------
function startReply(messageId) {
  const m = messageCache.get(messageId);
  if (!m) return;
  const author = profilesById[m.user_id]?.full_name || 'Inconnu';
  const preview = previewText(m).slice(0, 120);
  pendingReply = { id: messageId, author, preview };
  document.getElementById('replyAuthor').textContent = author;
  document.getElementById('replyText').textContent = preview;
  document.getElementById('replyPreview').hidden = false;
  document.getElementById('chatInput').focus();
}
function cancelReply() {
  pendingReply = null;
  document.getElementById('replyPreview').hidden = true;
}

// -----------------------------------------------------------
// Visio Jitsi : démarrage + ouverture modal
// -----------------------------------------------------------
// -----------------------------------------------------------
// Appels style WhatsApp : sonnerie chez les destinataires,
// accept/decline, auto-join Whereby.
// -----------------------------------------------------------
let currentCall = null;          // { id, room_url, audio_only, role: 'caller'|'callee' }
let outgoingTimer = null;        // timeout missed côté appelant
let ringtoneCtx = null;          // Web Audio context pour la sonnerie
let ringtoneTimer = null;

async function startVisio()      { return startCallFlow({ audioOnly: false }); }
async function startVoiceCall()  { return startCallFlow({ audioOnly: true  }); }

async function startCallFlow({ audioOnly }) {
  if (!me) return;
  if (!serverUrl) { alert('Serveur PC non configuré — impossible de lancer l\'appel'); return; }
  if (currentCall) { alert('Un appel est déjà en cours'); return; }

  // 1) Crée la room Whereby via pc-server (clé API cachée côté serveur)
  let roomUrl;
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error('Session expirée');
    const r = await fetch(`${serverUrl}/whereby/meeting`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioOnly })
    });
    if (!r.ok) throw new Error(await r.text());
    roomUrl = (await r.json()).roomUrl;
  } catch (e) {
    alert('Impossible de créer la réunion : ' + e.message);
    return;
  }

  // 2) Insert dans calls → notifie les autres participants en Realtime
  const { data: call, error } = await sb.from('calls').insert({
    conversation_id: currentConversationId,
    caller_id: me.id,
    audio_only: audioOnly,
    room_url: roomUrl,
    status: 'ringing'
  }).select().single();
  if (error) { alert('Erreur : ' + error.message); return; }

  currentCall = { id: call.id, room_url: roomUrl, audio_only: audioOnly, role: 'caller' };
  showOutgoingCallModal();

  // 3) Timeout 30s : si personne n'a répondu → status='missed'
  outgoingTimer = setTimeout(async () => {
    if (currentCall?.id !== call.id) return;
    await sb.from('calls').update({
      status: 'missed', ended_at: new Date().toISOString()
    }).eq('id', call.id).eq('status', 'ringing');
  }, 30000);
}

function showOutgoingCallModal() {
  const modal = document.getElementById('outgoingCallModal');
  const nameEl = document.getElementById('outgoingCallName');
  const avEl = document.getElementById('outgoingCallAvatar');
  const conv = currentConversationId;
  if (conv) {
    // DM ou groupe : affiche les autres participants
    const others = Object.values(profilesById).filter(p => p.id !== me.id);
    nameEl.textContent = others.length === 1 ? others[0].full_name : `${others.length} membres`;
    avEl.textContent = (others[0]?.full_name?.[0] || '?').toUpperCase();
  } else {
    nameEl.textContent = 'Toute l\'équipe';
    avEl.textContent = '#';
  }
  modal.hidden = false;
  document.body.classList.add('no-scroll');
  window.gcbtp?.renderIcons?.();
}

function hideOutgoingCallModal() {
  document.getElementById('outgoingCallModal').hidden = true;
  document.body.classList.remove('no-scroll');
  if (outgoingTimer) { clearTimeout(outgoingTimer); outgoingTimer = null; }
}

async function cancelOutgoingCall() {
  if (!currentCall || currentCall.role !== 'caller') return;
  await sb.from('calls').update({
    status: 'cancelled', ended_at: new Date().toISOString()
  }).eq('id', currentCall.id).eq('status', 'ringing');
  hideOutgoingCallModal();
  currentCall = null;
}

function showIncomingCallModal(call) {
  const caller = profilesById[call.caller_id];
  const modal = document.getElementById('incomingCallModal');
  document.getElementById('incomingCallName').textContent = caller?.full_name || 'Inconnu';
  document.getElementById('incomingCallSub').textContent = call.audio_only
    ? '📞 Appel vocal entrant' : '🎥 Visio entrante';
  document.getElementById('incomingCallAvatar').textContent =
    (caller?.full_name?.[0] || '?').toUpperCase();
  modal.hidden = false;
  document.body.classList.add('no-scroll');
  window.gcbtp?.renderIcons?.();
  startRingtone();
  // Vibration mobile (motif sonnerie)
  if (navigator.vibrate) {
    navigator.vibrate([400, 200, 400, 200, 400]);
  }
}

function hideIncomingCallModal() {
  document.getElementById('incomingCallModal').hidden = true;
  document.body.classList.remove('no-scroll');
  stopRingtone();
}

async function acceptIncomingCall() {
  if (!currentCall || currentCall.role !== 'callee') return;
  const call = currentCall;
  // Optimistic : on cache le modal tout de suite
  hideIncomingCallModal();
  const { error } = await sb.from('calls').update({
    status: 'active', answered_by: me.id, answered_at: new Date().toISOString()
  }).eq('id', call.id).eq('status', 'ringing');
  if (error) { alert('Erreur : ' + error.message); currentCall = null; return; }
  // Ouvrir Whereby chez moi (l'appelant ouvre via son listener Realtime)
  openJitsiModal(call.room_url, { audioOnly: call.audio_only });
}

async function declineIncomingCall() {
  if (!currentCall || currentCall.role !== 'callee') return;
  const call = currentCall;
  hideIncomingCallModal();
  await sb.from('calls').update({
    status: 'declined', ended_at: new Date().toISOString()
  }).eq('id', call.id).eq('status', 'ringing');
  currentCall = null;
}

// Sonnerie : double bip répété toutes les 2s via Web Audio API
function startRingtone() {
  stopRingtone();
  const ring = () => {
    try {
      if (!ringtoneCtx) ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = ringtoneCtx;
      [0, 0.4].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = i === 0 ? 880 : 660;
        osc.connect(gain).connect(ctx.destination);
        const t0 = ctx.currentTime + delay;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        osc.start(t0);
        osc.stop(t0 + 0.32);
      });
    } catch {}
  };
  ring();
  ringtoneTimer = setInterval(ring, 2000);
}
function stopRingtone() {
  if (ringtoneTimer) { clearInterval(ringtoneTimer); ringtoneTimer = null; }
  if (ringtoneCtx) { try { ringtoneCtx.close(); } catch {} ringtoneCtx = null; }
  if (navigator.vibrate) navigator.vibrate(0);
}

// Listener Realtime sur la table calls
function subscribeCalls() {
  sb.channel('calls-rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' },
        (p) => onCallInserted(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' },
        (p) => onCallUpdated(p.new))
    .subscribe();
}

function onCallInserted(call) {
  if (!me?.id) return;                              // pas encore prêt
  if (call.caller_id === me.id) return;             // mes propres appels gérés localement
  if (currentCall) return;                          // appel déjà en cours chez moi
  // Filtrage par conversation : Realtime ne respecte pas la RLS par défaut sur
  // postgres_changes, donc on doit vérifier ici qu'on est participant.
  if (call.conversation_id) {
    const members = participantsByConv[call.conversation_id] || [];
    if (!members.includes(me.id)) return;
  }
  // Ne réagir qu'aux ringing récents (< 35s, on tolère un peu de retard Realtime)
  const age = Date.now() - new Date(call.started_at).getTime();
  if (call.status !== 'ringing' || age > 35000) return;
  currentCall = { id: call.id, room_url: call.room_url, audio_only: call.audio_only, role: 'callee' };
  showIncomingCallModal(call);
}

function onCallUpdated(call) {
  if (!currentCall || currentCall.id !== call.id) return;
  if (call.status === 'active') {
    // Quelqu'un a accepté → si je suis l'appelant, j'ouvre Whereby chez moi
    if (currentCall.role === 'caller') {
      hideOutgoingCallModal();
      openJitsiModal(call.room_url, { audioOnly: call.audio_only });
    } else if (call.answered_by !== me?.id) {
      // En groupe : un autre a accepté avant moi → fermer ma sonnerie
      hideIncomingCallModal();
      currentCall = null;
    }
  } else if (['ended', 'declined', 'missed', 'cancelled'].includes(call.status)) {
    if (currentCall.role === 'caller') {
      hideOutgoingCallModal();
      const msg = call.status === 'declined' ? 'Appel refusé'
                : call.status === 'missed'   ? 'Personne n\'a répondu'
                : null;
      if (msg) alert(msg);
    } else {
      hideIncomingCallModal();
    }
    closeJitsiModal();
    currentCall = null;
  }
}

// Visio Whereby : simple iframe + listener postMessage pour fermeture auto
// quand l'utilisateur clique "Quitter" dans Whereby.
function openJitsiModal(url, opts = {}) {
  const modal = document.getElementById('jitsiModal');
  const container = document.getElementById('jitsiFrameContainer');
  const titleEl = document.getElementById('jitsiModalTitle');
  if (!modal || !container) return;
  const audioOnly = opts.audioOnly ?? /\/gcbtp-audio-/.test(url);
  if (titleEl) {
    titleEl.innerHTML = audioOnly
      ? '<i data-lucide="phone"></i> Appel vocal'
      : '<i data-lucide="video"></i> Réunion';
  }

  // Construit l'URL embed Whereby. Params utiles :
  //   embed              : mode embed (obligatoire pour postMessage)
  //   iframeSource       : indique l'origine de l'app
  //   displayName        : nom préféré de l'utilisateur
  //   video=off          : caméra coupée d'office (mode audio-only)
  //   chat=off,people=off: simplifie l'interface
  const params = new URLSearchParams({
    embed: '',
    iframeSource: window.location.origin,
    displayName: me?.full_name || 'Invité'
  });
  if (audioOnly) params.set('video', 'off');
  const sep = url.includes('?') ? '&' : '?';
  const fullUrl = `${url}${sep}${params.toString()}`;

  container.innerHTML = `<iframe class="jitsi-modal-frame" allow="camera; microphone; fullscreen; display-capture; autoplay; screen-wake-lock; compute-pressure" src="${fullUrl}"></iframe>`;
  modal.hidden = false;
  document.body.classList.add('no-scroll');
  window.gcbtp?.renderIcons?.();
}

function closeJitsiModal() {
  const modal = document.getElementById('jitsiModal');
  const container = document.getElementById('jitsiFrameContainer');
  if (!modal || modal.hidden) return;
  if (container) {
    // Forcer about:blank avant de remove → coupe les peer connections WebRTC
    // proprement et libère caméra/micro tout de suite (sans attendre le GC).
    const iframe = container.querySelector('iframe');
    if (iframe) iframe.src = 'about:blank';
    container.innerHTML = '';
  }
  modal.hidden = true;
  document.body.classList.remove('no-scroll');
  // Si un appel était lié, le marquer terminé en DB (le Realtime ferme chez les autres)
  if (currentCall) {
    sb.from('calls').update({
      status: 'ended', ended_at: new Date().toISOString()
    }).eq('id', currentCall.id).neq('status', 'ended').then(() => {});
    currentCall = null;
  }
}

// Écoute les events postMessage envoyés par l'iframe Whereby pour fermer
// automatiquement le modal quand l'utilisateur quitte la réunion.
window.addEventListener('message', (e) => {
  if (typeof e.data !== 'object' || !e.data) return;
  if (!/\.whereby\.com$/.test(new URL(e.origin).hostname)) return;
  const t = e.data.type;
  if (t === 'leave' || t === 'meeting_ended') closeJitsiModal();
});

function jumpToMessage(id) {
  const target = document.querySelector(`.msg[data-id="${id}"]`);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('msg-flash');
  setTimeout(() => target.classList.remove('msg-flash'), 1200);
}

// -----------------------------------------------------------
// Réactions emoji
// -----------------------------------------------------------
function applyReactionDelta(r, delta) {
  if (!r) return;
  let byEmoji = reactionsByMessage.get(r.message_id);
  if (!byEmoji) { byEmoji = new Map(); reactionsByMessage.set(r.message_id, byEmoji); }
  let users = byEmoji.get(r.emoji);
  if (!users) { users = new Set(); byEmoji.set(r.emoji, users); }
  if (delta > 0) users.add(r.user_id);
  else users.delete(r.user_id);
  if (users.size === 0) byEmoji.delete(r.emoji);
}

function renderReactionsFor(messageId) {
  const container = document.querySelector(`.msg-reactions[data-msg="${messageId}"]`);
  if (!container) return;
  const byEmoji = reactionsByMessage.get(messageId);
  if (!byEmoji || byEmoji.size === 0) { container.innerHTML = ''; return; }
  container.innerHTML = [...byEmoji.entries()].map(([emoji, users]) => {
    const mineCls = users.has(me?.id) ? ' rx-mine' : '';
    return `<button type="button" class="msg-rx${mineCls}" data-msg="${messageId}" data-emoji="${emoji}">
      <span>${emoji}</span><span class="rx-count">${users.size}</span>
    </button>`;
  }).join('');
}

async function toggleReaction(messageId, emoji) {
  if (!me) return;
  const byEmoji = reactionsByMessage.get(messageId);
  const has = byEmoji?.get(emoji)?.has(me.id);
  if (has) {
    await sb.from('message_reactions').delete()
      .eq('message_id', messageId).eq('user_id', me.id).eq('emoji', emoji);
    applyReactionDelta({ message_id: messageId, user_id: me.id, emoji }, -1);
  } else {
    await sb.from('message_reactions').insert({ message_id: messageId, user_id: me.id, emoji });
    applyReactionDelta({ message_id: messageId, user_id: me.id, emoji }, +1);
  }
  renderReactionsFor(messageId);
}

function openReactionPicker(messageId, anchorBtn) {
  pickerTargetMessageId = messageId;
  const picker = document.getElementById('reactionPicker');
  const rect = anchorBtn.getBoundingClientRect();
  picker.hidden = false;
  // positionner au-dessus du bouton
  const pickerRect = picker.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - pickerRect.width / 2;
  left = Math.max(8, Math.min(window.innerWidth - pickerRect.width - 8, left));
  let top = rect.top - pickerRect.height - 8;
  if (top < 8) top = rect.bottom + 8;
  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
}
function closeReactionPicker() {
  document.getElementById('reactionPicker').hidden = true;
  pickerTargetMessageId = null;
}

// -----------------------------------------------------------
// Accusés de lecture
// -----------------------------------------------------------
function addRead(messageId, userId) {
  let s = readsByMessage.get(messageId);
  if (!s) { s = new Set(); readsByMessage.set(messageId, s); }
  s.add(userId);
}
function renderTicksFor(messageId) {
  const el = document.querySelector(`.msg-ticks[data-msg="${messageId}"]`);
  if (!el) return;
  const reads = readsByMessage.get(messageId);
  const otherReaders = [...(reads || [])].filter(uid => uid !== me?.id);
  if (otherReaders.length > 0) {
    el.textContent = '✓✓';
    el.classList.add('msg-ticks-read');
    el.title = `Lu par ${otherReaders.length} personne${otherReaders.length > 1 ? 's' : ''}`;
  } else {
    el.textContent = '✓';
    el.classList.remove('msg-ticks-read');
    el.title = 'Envoyé';
  }
}

async function markVisibleAsRead() {
  if (!me || document.hidden) return;
  // Marquer tous les messages visibles non envoyés par moi et non encore lus
  const list = document.getElementById('messagesList');
  if (!list) return;
  const ids = [];
  list.querySelectorAll('.msg').forEach(div => {
    const id = div.dataset.id;
    const m = messageCache.get(id);
    if (!m || m.user_id === me.id) return;
    const reads = readsByMessage.get(id);
    if (reads && reads.has(me.id)) return;
    ids.push(id);
  });
  if (ids.length === 0) return;
  const rows = ids.map(message_id => ({ message_id, user_id: me.id }));
  // Optimiste (pour ne pas re-déclencher en boucle)
  ids.forEach(id => addRead(id, me.id));
  await sb.from('message_reads').upsert(rows, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
}

// -----------------------------------------------------------
// Mentions @prénom
// -----------------------------------------------------------
function renderMessageContent(text) {
  // 1) escape, 2) mentions, 3) liens (Jitsi spécial → bouton, autres → <a>), 4) sauts
  const escaped = escapeHtml(text);
  const mentioned = escaped.replace(/(^|\s)@([A-Za-zÀ-ÿ][\wÀ-ÿ-]+)/g, (full, before, name) => {
    const profile = Object.values(profilesById).find(p => {
      const first = (p.full_name || '').split(/\s+/)[0];
      return first && first.toLowerCase() === name.toLowerCase();
    });
    if (!profile) return full;
    const meCls = profile.id === me?.id ? ' mention-me' : '';
    return `${before}<span class="mention${meCls}" data-user="${profile.id}">@${escapeHtml(name)}</span>`;
  });
  return mentioned
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}

function isMentioned(content) {
  if (!me || !content) return false;
  const first = (me.full_name || '').split(/\s+/)[0];
  if (!first) return false;
  const re = new RegExp(`(^|\\s)@${first}\\b`, 'i');
  return re.test(content);
}

function updateMentionPicker() {
  const input = document.getElementById('chatInput');
  const picker = document.getElementById('mentionPicker');
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos);
  const m = before.match(/(?:^|\s)@([A-Za-zÀ-ÿ][\wÀ-ÿ-]*)$/);
  if (!m) { mentionState = null; picker.hidden = true; return; }
  const query = m[1].toLowerCase();
  mentionState = { start: pos - m[1].length - 1, query };
  const matches = Object.values(profilesById)
    .filter(p => p.id !== me?.id)
    .filter(p => {
      const first = (p.full_name || '').split(/\s+/)[0];
      return first && first.toLowerCase().startsWith(query);
    })
    .slice(0, 6);
  if (matches.length === 0) { picker.hidden = true; return; }
  picker.innerHTML = matches.map(p => {
    const first = (p.full_name || '').split(/\s+/)[0];
    return `<button type="button" data-user="${p.id}" data-first="${escapeHtml(first)}">
      <span class="mp-name">${escapeHtml(p.full_name)}</span>
      <span class="mp-handle">@${escapeHtml(first)}</span>
    </button>`;
  }).join('');
  // Position au-dessus de l'input
  const rect = input.getBoundingClientRect();
  picker.hidden = false;
  const pickerRect = picker.getBoundingClientRect();
  picker.style.left = `${Math.max(8, rect.left)}px`;
  picker.style.top = `${rect.top - pickerRect.height - 6}px`;
}

function applyMention(profile) {
  if (!mentionState) return;
  const input = document.getElementById('chatInput');
  const first = (profile.full_name || '').split(/\s+/)[0] || '';
  const before = input.value.slice(0, mentionState.start);
  const after = input.value.slice(input.selectionStart);
  input.value = `${before}@${first} ${after}`;
  const newPos = before.length + first.length + 2;
  input.setSelectionRange(newPos, newPos);
  mentionState = null;
  document.getElementById('mentionPicker').hidden = true;
  input.focus();
}

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
})();
