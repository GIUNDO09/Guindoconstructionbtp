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
  if (f.bio) f.bio.value = state.me.bio || '';
  if (f.description) f.description.value = state.me.description || '';
  if (f.portfolio_url) f.portfolio_url.value = state.me.portfolio_url || '';
  if (f.website_url) f.website_url.value = state.me.website_url || '';
  if (f.cv_url) f.cv_url.value = state.me.cv_url || '';
  if (f.linkedin_url) f.linkedin_url.value = state.me.linkedin_url || '';

  // Lien vers la version publique
  const viewBtn = document.getElementById('viewPublicProfileBtn');
  if (viewBtn) viewBtn.href = `profil-public.html?id=${state.me.id}`;

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

  // Changement de mot de passe
  document.getElementById('passwordForm').addEventListener('submit', onPasswordSubmit);

  // Notifications push
  initPushUI();
}

async function initPushUI() {
  const subBtn = document.getElementById('pushSubscribeBtn');
  const unsubBtn = document.getElementById('pushUnsubscribeBtn');
  const status = document.getElementById('pushStatus');
  if (!subBtn || !unsubBtn || !status) return;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    status.textContent = '⚠️ Ce navigateur ne supporte pas les notifications push.';
    status.className = 'form-hint form-hint-warn';
    return;
  }

  async function refresh() {
    try {
      const isSub = await window.gcbtp.push.isSubscribed();
      subBtn.hidden = isSub;
      unsubBtn.hidden = !isSub;
      status.textContent = isSub ? '✅ Notifications push activées sur cet appareil' : '';
      status.className = isSub ? 'form-hint form-hint-ok' : 'form-hint';
    } catch (e) {
      status.textContent = '⚠️ ' + e.message;
      status.className = 'form-hint form-hint-warn';
    }
  }

  subBtn.addEventListener('click', async () => {
    subBtn.disabled = true;
    status.textContent = '⏳ Activation…';
    status.className = 'form-hint';
    try {
      await window.gcbtp.push.subscribe();
      await refresh();
    } catch (e) {
      status.textContent = '❌ ' + e.message;
      status.className = 'form-hint form-hint-warn';
    } finally {
      subBtn.disabled = false;
    }
  });

  unsubBtn.addEventListener('click', async () => {
    unsubBtn.disabled = true;
    status.textContent = '⏳ Désactivation…';
    status.className = 'form-hint';
    try {
      await window.gcbtp.push.unsubscribe();
      await refresh();
    } catch (e) {
      status.textContent = '❌ ' + e.message;
      status.className = 'form-hint form-hint-warn';
    } finally {
      unsubBtn.disabled = false;
    }
  });

  await refresh();
}

async function onPasswordSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById('passwordStatus');
  const fd = new FormData(form);
  const newPwd = fd.get('new_password');
  const confirm = fd.get('confirm_password');

  if (newPwd !== confirm) {
    status.textContent = '❌ Les deux mots de passe ne correspondent pas';
    status.className = 'form-hint form-hint-warn';
    return;
  }
  if (newPwd.length < 8) {
    status.textContent = '❌ Au moins 8 caractères requis';
    status.className = 'form-hint form-hint-warn';
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  status.textContent = '⏳ Mise à jour…';
  status.className = 'form-hint';

  try {
    const { error } = await sb.auth.updateUser({ password: newPwd });
    if (error) throw error;
    form.reset();
    status.textContent = '✅ Mot de passe mis à jour';
    status.className = 'form-hint form-hint-ok';
  } catch (err) {
    status.textContent = '❌ ' + (err.message || 'Échec');
    status.className = 'form-hint form-hint-warn';
  } finally {
    submitBtn.disabled = false;
  }
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
    phone:              f.phone.value.trim() || null,
    bio:                f.bio?.value.trim() || null,
    description:        f.description?.value.trim() || null,
    portfolio_url:      f.portfolio_url?.value.trim() || null,
    website_url:        f.website_url?.value.trim() || null,
    cv_url:             f.cv_url?.value.trim() || null,
    linkedin_url:       f.linkedin_url?.value.trim() || null
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
