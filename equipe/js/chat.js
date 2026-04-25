(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

let me = null;
let profilesById = {};

(async () => {
  const session = await requireAuth();
  if (!session) return;

  bindUI();

  me = await currentProfile();
  document.getElementById('userName').textContent = me?.full_name || session.user.email;

  await loadProfiles();
  await loadMessages();

  // Realtime : nouveaux messages
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
    .subscribe();
})();

// Joue un bip + notification système si le message vient d'un autre membre
function notifyIfNeeded(m) {
  if (m.user_id === me?.id) return;  // mon propre message
  const author = profilesById[m.user_id]?.full_name || 'Quelqu\'un';
  const preview = m.content.length > 80 ? m.content.slice(0, 80) + '…' : m.content;

  // Bip sonore (toujours joué quand un nouveau message arrive)
  window.gcbtp?.notif?.chime();

  // Notification système : seulement si la fenêtre n'est pas active
  if (document.hidden || !document.hasFocus()) {
    const notif = window.gcbtp?.notif?.show(`💬 ${author}`, preview, { tag: 'gcbtp-chat' });
    if (notif) {
      notif.onclick = () => { window.focus(); notif.close(); };
    }
  }
}

async function loadProfiles() {
  const { data } = await sb.from('profiles').select('id, full_name');
  profilesById = Object.fromEntries((data || []).map(p => [p.id, p]));
}

async function loadMessages() {
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) { console.error(error); return; }
  const list = document.getElementById('messagesList');
  list.innerHTML = '';
  (data || []).forEach(m => appendMessage(m, false));
  scrollToBottom();
}

function appendMessage(m, animate) {
  const list = document.getElementById('messagesList');
  // Éviter les doublons si déjà rendu
  if (list.querySelector(`[data-id="${m.id}"]`)) return;
  const mine = m.user_id === me?.id;
  const author = profilesById[m.user_id]?.full_name || 'Inconnu';
  const when = new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = `msg ${mine ? 'msg-mine' : ''} ${animate ? 'msg-new' : ''}`;
  div.dataset.id = m.id;
  div.innerHTML = `
    <div class="msg-bubble">
      <div class="msg-head">
        <span class="msg-author">${escapeHtml(author)}</span>
        <span class="msg-time">${when}</span>
      </div>
      <div class="msg-content">${linkify(escapeHtml(m.content))}</div>
      ${mine ? `<button class="msg-delete" title="Supprimer" data-id="${m.id}">×</button>` : ''}
    </div>`;
  list.appendChild(div);
  scrollToBottom();
}

function removeMessage(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
}

function scrollToBottom() {
  const list = document.getElementById('messagesList');
  list.scrollTop = list.scrollHeight;
}

function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Bouton "Activer notifications" : visible si la permission n'est pas accordée
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

  const form = document.getElementById('chatForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    if (!content || !me) return;
    input.value = '';
    input.disabled = true;
    const { error } = await sb.from('messages').insert({ user_id: me.id, content });
    input.disabled = false;
    input.focus();
    if (error) alert('Erreur: ' + error.message);
  });

  // Enter pour envoyer, Shift+Enter pour nouvelle ligne
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Supprimer message
  document.getElementById('messagesList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.msg-delete');
    if (!btn) return;
    if (!confirm('Supprimer ce message ?')) return;
    const { error } = await sb.from('messages').delete().eq('id', btn.dataset.id);
    if (error) alert('Erreur: ' + error.message);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function linkify(html) {
  return html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
             .replace(/\n/g, '<br>');
}
})();
