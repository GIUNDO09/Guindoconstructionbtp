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
  state.serverUrl = await window.gcbtp.cache.getServerUrl();
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

  // Avatar cliquable → page profil public
  const avatarLink = document.getElementById('avatarPreview');
  if (avatarLink && avatarLink.tagName === 'A') {
    avatarLink.href = `profil-public.html?id=${state.me.id}`;
  }

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

  // Upload avatar (passe d'abord par le cropper)
  document.getElementById('avatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // permet de re-choisir le même fichier
    if (!file) return;
    if (!state.serverUrl) { alert('Serveur PC non configuré — impossible d\'uploader la photo'); return; }

    // Recadrage avant upload (l'utilisateur peut annuler)
    const cropped = await openCropper(file);
    if (!cropped) return;
    const toUpload = new File([cropped], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });

    const status = document.getElementById('avatarStatus');
    status.textContent = '⏳ Upload en cours…';
    status.className = 'form-hint';

    try {
      const token = (await sb.auth.getSession()).data.session.access_token;
      const fd = new FormData();
      fd.append('file', toUpload);
      fd.append('context', 'avatar');
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

      // Invalide le cache du header avatar pour que la pastille header reflète tout de suite
      try { window.gcbtp.cache.invalidate('gcbtp.me'); } catch {}

      state.me.avatar_file_id = uploaded.id;
      renderProfile();
      status.textContent = '✅ Photo mise à jour';
      status.className = 'form-hint form-hint-ok';
    } catch (err) {
      status.textContent = '❌ ' + err.message;
      status.className = 'form-hint form-hint-warn';
    }
  });

  bindCropper();

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

// ---------- Cropper d'avatar (modal recadrage) ----------
const cropper = {
  natural: null,        // { w, h }
  base: 1,              // échelle "cover" du viewport
  scale: 1,             // zoom user (1..4)
  pos: { x: 0, y: 0 },  // translation de l'image dans le viewport
  size: 280,            // taille du viewport (px), synchronisée avec le CSS
  outputSize: 512,      // taille du canvas de sortie
  resolve: null         // callback Promise en cours
};

function openCropper(file) {
  return new Promise((resolve) => {
    cropper.resolve = resolve;
    const modal = document.getElementById('cropModal');
    const img = document.getElementById('cropImage');
    const stage = document.getElementById('cropStage');
    const zoom = document.getElementById('cropZoom');

    cropper.scale = 1;
    cropper.pos = { x: 0, y: 0 };
    cropper.natural = null;
    cropper.size = stage.clientWidth || 280;
    zoom.value = '1';

    const reader = new FileReader();
    reader.onload = (ev) => {
      img.onload = () => {
        cropper.natural = { w: img.naturalWidth, h: img.naturalHeight };
        cropper.base = Math.max(
          cropper.size / cropper.natural.w,
          cropper.size / cropper.natural.h
        );
        const dispW = cropper.natural.w * cropper.base;
        const dispH = cropper.natural.h * cropper.base;
        cropper.pos.x = (cropper.size - dispW) / 2;
        cropper.pos.y = (cropper.size - dispH) / 2;
        applyCropTransform();
      };
      img.src = ev.target.result;
    };
    reader.onerror = () => closeCropper(null);
    reader.readAsDataURL(file);

    modal.hidden = false;
    document.body.classList.add('no-scroll');
  });
}

function applyCropTransform() {
  if (!cropper.natural) return;
  const img = document.getElementById('cropImage');
  const dispW = cropper.natural.w * cropper.base * cropper.scale;
  const dispH = cropper.natural.h * cropper.base * cropper.scale;
  // Borne la position pour que l'image couvre toujours le viewport
  const minX = cropper.size - dispW;
  const minY = cropper.size - dispH;
  cropper.pos.x = Math.min(0, Math.max(minX, cropper.pos.x));
  cropper.pos.y = Math.min(0, Math.max(minY, cropper.pos.y));
  img.style.width = dispW + 'px';
  img.style.height = dispH + 'px';
  img.style.transform = `translate(${cropper.pos.x}px, ${cropper.pos.y}px)`;
}

function closeCropper(blob) {
  const modal = document.getElementById('cropModal');
  modal.hidden = true;
  document.body.classList.remove('no-scroll');
  document.getElementById('cropImage').removeAttribute('src');
  const cb = cropper.resolve;
  cropper.resolve = null;
  if (cb) cb(blob);
}

function renderCropToBlob() {
  return new Promise((resolve) => {
    if (!cropper.natural) { resolve(null); return; }
    const img = document.getElementById('cropImage');
    const totalScale = cropper.base * cropper.scale;
    const sx = -cropper.pos.x / totalScale;
    const sy = -cropper.pos.y / totalScale;
    const sSize = cropper.size / totalScale;
    const out = cropper.outputSize;
    const canvas = document.createElement('canvas');
    canvas.width = out; canvas.height = out;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, out, out);
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
  });
}

let _cropperBound = false;
function bindCropper() {
  if (_cropperBound) return;
  _cropperBound = true;
  const stage = document.getElementById('cropStage');
  const zoom = document.getElementById('cropZoom');

  // Drag (pointer events = souris + tactile)
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, ox: cropper.pos.x, oy: cropper.pos.y };
    try { stage.setPointerCapture(e.pointerId); } catch {}
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cropper.pos.x = drag.ox + (e.clientX - drag.x);
    cropper.pos.y = drag.oy + (e.clientY - drag.y);
    applyCropTransform();
  });
  const endDrag = () => { drag = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // Zoom slider — garde le centre du viewport pointé sur le même pixel source
  zoom.addEventListener('input', (e) => {
    if (!cropper.natural) return;
    const newScale = parseFloat(e.target.value) || 1;
    const cx = cropper.size / 2, cy = cropper.size / 2;
    const tBefore = cropper.base * cropper.scale;
    const sxBefore = (cx - cropper.pos.x) / tBefore;
    const syBefore = (cy - cropper.pos.y) / tBefore;
    cropper.scale = newScale;
    const tAfter = cropper.base * cropper.scale;
    cropper.pos.x = cx - sxBefore * tAfter;
    cropper.pos.y = cy - syBefore * tAfter;
    applyCropTransform();
  });

  // Wheel = zoom (desktop)
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    const ns = Math.max(1, Math.min(4, cropper.scale + delta));
    zoom.value = String(ns);
    zoom.dispatchEvent(new Event('input'));
  }, { passive: false });

  document.getElementById('cropCancel').addEventListener('click', () => closeCropper(null));
  document.getElementById('cropApply').addEventListener('click', async () => {
    const blob = await renderCropToBlob();
    closeCropper(blob);
  });
  document.getElementById('cropModal').addEventListener('click', (e) => {
    if (e.target.id === 'cropModal') closeCropper(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('cropModal').hidden) closeCropper(null);
  });
}
})();
