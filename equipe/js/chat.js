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

(async () => {
  const session = await requireAuth();
  if (!session) return;

  bindUI();

  me = await currentProfile();
  document.getElementById('userName').textContent = me?.full_name || session.user.email;

  await loadProfiles();
  await loadServerUrl();
  await loadMessages();

  chatChannel = sb.channel('messages-realtime', { config: { broadcast: { self: false } } })
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        appendMessage(payload.new, true);
        notifyIfNeeded(payload.new);
        markVisibleAsRead();
      }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => removeMessage(payload.old.id)
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: 'key=eq.file_server_url' },
      async () => { await loadServerUrl(); }
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
    .subscribe();

  // Marquer comme lu quand la fenêtre est active
  window.addEventListener('focus', markVisibleAsRead);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) markVisibleAsRead(); });
})();

async function loadServerUrl() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'file_server_url').maybeSingle();
  serverUrl = data?.value || null;
}

function notifyIfNeeded(m) {
  if (m.user_id === me?.id) return;
  const author = profilesById[m.user_id]?.full_name || 'Quelqu\'un';
  const mentioned = isMentioned(m.content);
  const preview = (mentioned ? '🔔 ' : '') + previewText(m);
  window.gcbtp?.notif?.chime();
  if (document.hidden || !document.hasFocus() || mentioned) {
    const title = mentioned ? `🔔 ${author} t'a mentionné` : `💬 ${author}`;
    const notif = window.gcbtp?.notif?.show(title, preview, { tag: 'gcbtp-chat' });
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
  const { data } = await sb.from('profiles').select('id, full_name');
  profilesById = Object.fromEntries((data || []).map(p => [p.id, p]));
}

async function loadMessages() {
  const { data, error } = await sb
    .from('messages').select('*')
    .order('created_at', { ascending: true }).limit(200);
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
          <button type="button" class="msa-play" aria-label="Lire">▶</button>
          <div class="msa-track" role="slider" aria-label="Position de lecture" tabindex="0">
            <div class="msa-progress"></div>
          </div>
          <span class="msa-time">0:00</span>
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
          <span class="msg-doc-dl">⬇</span>
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

  div.innerHTML = `
    <div class="msg-bubble">
      <div class="msg-head">
        <span class="msg-author">${escapeHtml(author)}</span>
        <span class="msg-time">${when}</span>
      </div>
      ${quoteHtml}
      ${attachmentHtml}
      ${contentHtml}
      <div class="msg-footer">
        <div class="msg-reactions" data-msg="${m.id}"></div>
        ${mine ? `<span class="msg-ticks" data-msg="${m.id}">✓</span>` : ''}
      </div>
      <div class="msg-actions">
        <button type="button" class="msg-act msg-act-react" title="Réagir" data-id="${m.id}">😊</button>
        <button type="button" class="msg-act msg-act-reply" title="Répondre" data-id="${m.id}">↩</button>
        ${mine ? `<button class="msg-act msg-delete" title="Supprimer" data-id="${m.id}">🗑</button>` : ''}
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
    playBtn.textContent = '⏸';
    playBtn.setAttribute('aria-label', 'Pause');
    player.classList.add('msa-playing');
  });
  audio.addEventListener('pause', () => {
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Lire');
    player.classList.remove('msa-playing');
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
    attachment_type: attachmentType
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
  // 1) escape, 2) mentions, 3) liens, 4) sauts de ligne
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
