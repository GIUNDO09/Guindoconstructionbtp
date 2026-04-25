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

(async () => {
  const session = await requireAuth();
  if (!session) return;

  bindUI();

  me = await currentProfile();
  document.getElementById('userName').textContent = me?.full_name || session.user.email;

  await loadProfiles();
  await loadServerUrl();
  await loadMessages();

  sb.channel('messages-realtime')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        appendMessage(payload.new, true);
        notifyIfNeeded(payload.new);
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
    .subscribe();
})();

async function loadServerUrl() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'file_server_url').maybeSingle();
  serverUrl = data?.value || null;
}

function notifyIfNeeded(m) {
  if (m.user_id === me?.id) return;
  const author = profilesById[m.user_id]?.full_name || 'Quelqu\'un';
  const preview = previewText(m);
  window.gcbtp?.notif?.chime();
  if (document.hidden || !document.hasFocus()) {
    const notif = window.gcbtp?.notif?.show(`💬 ${author}`, preview, { tag: 'gcbtp-chat' });
    if (notif) notif.onclick = () => { window.focus(); notif.close(); };
  }
}

function previewText(m) {
  if (m.attachment_type === 'image') return '📷 Image' + (m.content ? ` — ${m.content}` : '');
  if (m.attachment_type === 'video') return '🎞️ Vidéo' + (m.content ? ` — ${m.content}` : '');
  if (m.attachment_type === 'audio') return '🎤 Message vocal';
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
  (data || []).forEach(m => appendMessage(m, false));
  scrollToBottom();
}

function appendMessage(m, animate) {
  const list = document.getElementById('messagesList');
  if (list.querySelector(`[data-id="${m.id}"]`)) return;
  const mine = m.user_id === me?.id;
  const author = profilesById[m.user_id]?.full_name || 'Inconnu';
  const when = new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = `msg ${mine ? 'msg-mine' : ''} ${animate ? 'msg-new' : ''}`;
  div.dataset.id = m.id;

  let attachmentHtml = '';
  if (m.attachment_file_id && m.attachment_type) {
    const fid = m.attachment_file_id;
    if (m.attachment_type === 'image') {
      attachmentHtml = `<div class="msg-media"><img data-media-id="${fid}" alt="image" onclick="this.classList.toggle('msg-media-zoom')"></div>`;
    } else if (m.attachment_type === 'video') {
      attachmentHtml = `<div class="msg-media"><video data-media-id="${fid}" controls preload="metadata"></video></div>`;
    } else if (m.attachment_type === 'audio') {
      attachmentHtml = `<div class="msg-audio"><audio data-media-id="${fid}" controls preload="metadata"></audio></div>`;
    }
  }

  div.innerHTML = `
    <div class="msg-bubble">
      <div class="msg-head">
        <span class="msg-author">${escapeHtml(author)}</span>
        <span class="msg-time">${when}</span>
      </div>
      ${attachmentHtml}
      ${m.content ? `<div class="msg-content">${linkify(escapeHtml(m.content))}</div>` : ''}
      ${mine ? `<button class="msg-delete" title="Supprimer" data-id="${m.id}">×</button>` : ''}
    </div>`;
  list.appendChild(div);

  // Hydrater les médias avec auth
  div.querySelectorAll('[data-media-id]').forEach(el => loadAuthedMedia(el, el.dataset.mediaId));
  scrollToBottom();
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

  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Suppression message
  document.getElementById('messagesList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.msg-delete');
    if (!btn) return;
    if (!confirm('Supprimer ce message ?')) return;
    // Récupérer le message pour aussi supprimer le fichier disque
    const { data: msg } = await sb.from('messages').select('attachment_file_id').eq('id', btn.dataset.id).single();
    if (msg?.attachment_file_id && serverUrl) {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      await fetch(`${serverUrl}/file/${msg.attachment_file_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    } else {
      await sb.from('messages').delete().eq('id', btn.dataset.id);
    }
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
                : file.type.startsWith('audio/') ? 'audio' : null;
    if (!type) { alert('Format non supporté'); return; }
    pendingAttachment = { file, type };
    showAttachmentPreview();
  });

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
  const icon = pendingAttachment.type === 'image' ? '📷'
              : pendingAttachment.type === 'video' ? '🎞️' : '🎵';
  document.getElementById('attachmentName').textContent =
    `${icon} ${pendingAttachment.file.name} (${(pendingAttachment.file.size / 1024 / 1024).toFixed(2)} Mo)`;
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
  const { error } = await sb.from('messages').insert({
    user_id: me.id,
    content: content || null,
    attachment_file_id: attachmentFileId,
    attachment_type: attachmentType
  });

  input.value = '';
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
// Helpers
// -----------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function linkify(html) {
  return html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
             .replace(/\n/g, '<br>');
}
})();
