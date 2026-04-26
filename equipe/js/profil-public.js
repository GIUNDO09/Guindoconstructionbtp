(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

const state = {
  me: null,
  profile: null,
  serverUrl: null,
  history: [],
  taskStats: { total: 0, done: 0, in_progress: 0 }
};

(async () => {
  const session = await requireAuth();
  if (!session) return;

  const params = new URLSearchParams(location.search);
  const targetId = params.get('id');
  if (!targetId) {
    document.getElementById('profileLoading').textContent = '❌ ID utilisateur manquant dans l\'URL';
    return;
  }

  bindUI();
  state.me = await currentProfile();
  document.getElementById('userName').textContent = state.me?.full_name || session.user.email;

  await loadServerUrl();
  await loadProfile(targetId);
  if (!state.profile) {
    document.getElementById('profileLoading').textContent = '❌ Profil introuvable';
    return;
  }
  await Promise.all([loadHistory(targetId), loadTaskStats(targetId)]);
  render();
})();

async function loadServerUrl() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'file_server_url').maybeSingle();
  state.serverUrl = data?.value || null;
}

async function loadProfile(id) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) { console.error(error); return; }
  state.profile = data;
}

async function loadHistory(id) {
  const ago = new Date(); ago.setDate(ago.getDate() - 90); // 12 semaines
  const { data } = await sb
    .from('profile_score_history')
    .select('*')
    .eq('user_id', id)
    .gte('recorded_at', ago.toISOString().slice(0, 10))
    .order('recorded_at', { ascending: true });
  state.history = data || [];
}

async function loadTaskStats(id) {
  // Tâches assignées à ce user
  const { data: links } = await sb.from('task_assignees').select('task_id').eq('user_id', id);
  const taskIds = (links || []).map(l => l.task_id);
  if (taskIds.length === 0) {
    state.taskStats = { total: 0, done: 0, in_progress: 0 };
    return;
  }
  const { data: tasks } = await sb.from('tasks').select('id, status').in('id', taskIds);
  const total = tasks?.length || 0;
  const done = (tasks || []).filter(t => t.status === 'done').length;
  const inProgress = (tasks || []).filter(t => t.status === 'in_progress').length;
  state.taskStats = { total, done, in_progress: inProgress };
}

function render() {
  document.getElementById('profileLoading').hidden = true;
  document.getElementById('profileContent').hidden = false;

  const p = state.profile;

  // Hero
  document.getElementById('ppName').textContent = p.full_name || 'Sans nom';
  document.getElementById('ppTitle').textContent = p.title || '';
  document.getElementById('ppRole').textContent = p.role === 'admin' ? '👑 Admin' : '👤 Membre';
  document.getElementById('ppBio').textContent = p.bio || '';

  // Avatar
  const avatarBox = document.getElementById('ppAvatar');
  avatarBox.innerHTML = '';
  if (p.avatar_file_id && state.serverUrl) {
    const img = document.createElement('img');
    img.alt = 'Photo de profil';
    avatarBox.appendChild(img);
    loadAuthedImage(img, p.avatar_file_id);
  } else {
    avatarBox.innerHTML = `<span class="avatar-initials-lg">${escapeHtml(initials(p.full_name || '?'))}</span>`;
  }

  // Liens
  const linksBox = document.getElementById('ppLinks');
  const links = [];
  if (p.portfolio_url) links.push({ icon: '🎨', label: 'Portfolio', url: p.portfolio_url });
  if (p.website_url)   links.push({ icon: '🌐', label: 'Site web',  url: p.website_url });
  if (p.cv_url)        links.push({ icon: '📄', label: 'CV',        url: p.cv_url });
  if (p.linkedin_url)  links.push({ icon: '💼', label: 'LinkedIn',  url: p.linkedin_url });
  linksBox.innerHTML = links.map(l =>
    `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener" class="pp-link">${l.icon} ${l.label}</a>`
  ).join('');

  // Bouton "Éditer" si c'est mon propre profil
  if (state.me?.id === p.id) {
    document.getElementById('ppEditBtn').hidden = false;
  }

  // Stats
  document.getElementById('ppWorkScore').textContent = p.work_score ?? 0;
  document.getElementById('ppAttendance').textContent = p.attendance_score ?? 0;
  document.getElementById('ppEarnings').textContent = formatNumber(p.total_earnings || 0);
  document.getElementById('ppTasksDone').textContent = state.taskStats.done;
  document.getElementById('ppTasksTotal').textContent = `sur ${state.taskStats.total} assignée(s)`;

  // Description
  if (p.description) {
    document.getElementById('ppDescriptionSection').hidden = false;
    document.getElementById('ppDescription').textContent = p.description;
  }

  // Historique (mini-graphique en barres SVG)
  renderHistory();

  // Édition admin
  if (state.me?.role === 'admin' && state.me.id !== p.id) {
    const sec = document.getElementById('adminEditSection');
    sec.hidden = false;
    const f = document.getElementById('adminScoreForm');
    f.work_score.value       = p.work_score ?? 0;
    f.attendance_score.value = p.attendance_score ?? 0;
    f.total_earnings.value   = p.total_earnings ?? 0;
  }
}

function renderHistory() {
  const box = document.getElementById('ppHistory');
  if (!state.history.length) {
    box.innerHTML = '<p class="empty">Aucun historique encore. Les snapshots sont enregistrés chaque lundi.</p>';
    return;
  }
  // 3 séries : work_score, attendance_score, earnings (normalisé)
  const w = 600, h = 180, pad = 28;
  const points = state.history;
  const maxEarnings = Math.max(1, ...points.map(p => Number(p.total_earnings) || 0));

  const xFor = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, points.length - 1);
  const yScore = (v) => h - pad - (Math.max(0, Math.min(100, v || 0)) / 100) * (h - 2 * pad);
  const yEarn = (v) => h - pad - ((Number(v) || 0) / maxEarnings) * (h - 2 * pad);

  const polyline = (vals, yfn, color) => {
    const d = vals.map((v, i) => `${xFor(i)},${yfn(v)}`).join(' ');
    return `<polyline points="${d}" fill="none" stroke="${color}" stroke-width="2"/>` +
           vals.map((v, i) => `<circle cx="${xFor(i)}" cy="${yfn(v)}" r="3" fill="${color}"/>`).join('');
  };

  box.innerHTML = `
    <div class="pp-history-legend">
      <span><span class="pp-leg-dot" style="background:#e87722"></span> Score travail</span>
      <span><span class="pp-leg-dot" style="background:#2563eb"></span> Assiduité</span>
      <span><span class="pp-leg-dot" style="background:#16a34a"></span> Gains</span>
    </div>
    <svg viewBox="0 0 ${w} ${h}" class="pp-history-svg" role="img" aria-label="Évolution des scores">
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="#ddd" stroke-width="1"/>
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#ddd" stroke-width="1"/>
      ${polyline(points.map(p => p.work_score), yScore, '#e87722')}
      ${polyline(points.map(p => p.attendance_score), yScore, '#2563eb')}
      ${polyline(points.map(p => p.total_earnings), yEarn, '#16a34a')}
    </svg>
    <div class="pp-history-axis">
      ${points.map(p => `<span>${formatShortDate(p.recorded_at)}</span>`).join('')}
    </div>
  `;
}

function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Soumission édition admin
  document.getElementById('adminScoreForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const status = document.getElementById('adminScoreStatus');
    status.textContent = '⏳ Enregistrement…';
    status.className = 'form-hint';

    const work_score       = clamp(parseInt(f.work_score.value, 10) || 0, 0, 100);
    const attendance_score = clamp(parseInt(f.attendance_score.value, 10) || 0, 0, 100);
    const total_earnings   = Math.max(0, parseFloat(f.total_earnings.value) || 0);
    const notes            = f.notes.value.trim() || null;

    const { error } = await sb.from('profiles').update({
      work_score, attendance_score, total_earnings
    }).eq('id', state.profile.id);
    if (error) {
      status.textContent = '❌ ' + error.message;
      status.className = 'form-hint form-hint-warn';
      return;
    }

    // Snapshot dans l'historique
    const today = new Date().toISOString().slice(0, 10);
    await sb.from('profile_score_history').upsert({
      user_id: state.profile.id,
      work_score, attendance_score, total_earnings,
      recorded_at: today,
      notes
    }, { onConflict: 'user_id,recorded_at' });

    Object.assign(state.profile, { work_score, attendance_score, total_earnings });
    await loadHistory(state.profile.id);
    render();
    status.textContent = '✅ Mis à jour + snapshot enregistré';
    status.className = 'form-hint form-hint-ok';
    setTimeout(() => { status.textContent = ''; }, 3000);
  });
}

// ---------- Helpers ----------
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
function initials(s) {
  const parts = String(s || '').trim().split(/\s+/);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function formatNumber(n) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}
function formatShortDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
})();
