(() => {
const { sb, requireAuth, logout } = window.gcbtp;

let state = {
  me: null,
  serverUrl: null,
  authEmail: null
};

(async () => {
  const session = await requireAuth();
  if (!session) return;
  state.authEmail = session.user.email;

  bindUI();
  await Promise.all([loadProfile(), loadServerUrl()]);
  renderProfile();
})();

async function loadProfile() {
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (error) { console.error(error); return; }
  state.me = data;
}

async function loadServerUrl() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'file_server_url').maybeSingle();
  state.serverUrl = data?.value || null;
}

function renderProfile() {
  if (!state.me) return;
  document.getElementById('userName').textContent = state.me.full_name || state.authEmail;

  const f = document.getElementById('profileForm');
  f.full_name.value = state.me.full_name || '';
  f.title.value = state.me.title || '';
  f.notification_email.value = state.me.notification_email || '';
  f.phone.value = state.me.phone || '';

  // Email de connexion (read-only)
  document.getElementById('authEmail').textContent = state.authEmail;

  // Rôle (read-only)
  document.getElementById('roleBadge').textContent = state.me.role === 'admin' ? '👑 Admin' : '👤 Membre';

  // Avatar
  const avatarBox = document.getElementById('avatarPreview');
  avatarBox.innerHTML = '';
  if (state.me.avatar_file_id && state.serverUrl) {
    const img = document.createElement('img');
    img.alt = 'Photo de profil';
    avatarBox.appendChild(img);
    loadAuthedImage(img, state.me.avatar_file_id);
  } else {
    avatarBox.innerHTML = `<span class="avatar-initials-lg">${escapeHtml(initials(state.me.full_name || state.authEmail))}</span>`;
  }
}

function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  document.getElementById('profileForm').addEventListener('submit', onProfileSubmit);

  // Upload avatar
  document.getElementById('avatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!state.serverUrl) { alert('Serveur PC non configuré — impossible d\'uploader la photo'); return; }

    const status = document.getElementById('avatarStatus');
    status.textContent = '⏳ Upload en cours…';
    status.className = 'form-hint';

    try {
      const token = (await sb.auth.getSession()).data.session.access_token;
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`${state.serverUrl}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      if (!r.ok) throw new Error(await r.text());
      const { file: uploaded } = await r.json();

      // Mettre à jour le profil avec le nouvel avatar
      const { error } = await sb.from('profiles').update({ avatar_file_id: uploaded.id }).eq('id', state.me.id);
      if (error) throw new Error(error.message);

      state.me.avatar_file_id = uploaded.id;
      renderProfile();
      status.textContent = '✅ Photo mise à jour';
      status.className = 'form-hint form-hint-ok';
    } catch (err) {
      status.textContent = '❌ ' + err.message;
      status.className = 'form-hint form-hint-warn';
    }
  });

  document.getElementById('removeAvatarBtn').addEventListener('click', async () => {
    if (!confirm('Supprimer la photo de profil ?')) return;
    const { error } = await sb.from('profiles').update({ avatar_file_id: null }).eq('id', state.me.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    state.me.avatar_file_id = null;
    renderProfile();
  });
}

async function onProfileSubmit(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const status = document.getElementById('saveStatus');
  status.textContent = '⏳ Enregistrement…';
  status.className = 'form-hint';

  const payload = {
    full_name:          f.full_name.value.trim() || null,
    title:              f.title.value.trim() || null,
    notification_email: f.notification_email.value.trim() || null,
    phone:              f.phone.value.trim() || null
  };

  if (!payload.full_name) {
    status.textContent = '❌ Le nom complet est requis';
    status.className = 'form-hint form-hint-warn';
    return;
  }

  const { error } = await sb.from('profiles').update(payload).eq('id', state.me.id);
  if (error) {
    status.textContent = '❌ ' + error.message;
    status.className = 'form-hint form-hint-warn';
    return;
  }
  Object.assign(state.me, payload);
  renderProfile();
  status.textContent = '✅ Profil enregistré';
  status.className = 'form-hint form-hint-ok';
  setTimeout(() => { status.textContent = ''; }, 3000);
}

// Helpers (dupliqués sur cette page autonome)
function initials(s) {
  const parts = String(s || '').trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function loadAuthedImage(imgEl, fileId) {
  if (!state.serverUrl || !fileId) return;
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) return;
    const r = await fetch(`${state.serverUrl}/stream/${fileId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    imgEl.src = URL.createObjectURL(blob);
  } catch (e) {
    imgEl.style.display = 'none';
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
})();
