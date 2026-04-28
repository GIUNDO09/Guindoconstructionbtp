// =========================================================
// GCBTP — Page Projets (liste + création)
// =========================================================
(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

const state = {
  me: null,
  projects: [],
  members: {},          // project_id → [user_ids]
  tasksByProject: {},   // project_id → [tasks]
  profilesById: {},
  filterStatus: 'active',
  search: ''
};

(async () => {
  const session = await requireAuth();
  if (!session) return;

  bindUI();
  state.me = await currentProfile();
  document.getElementById('userName').textContent = state.me?.full_name || session.user.email;

  if (state.me?.role === 'admin') {
    document.getElementById('newProjBtn').hidden = false;
  }

  await Promise.all([loadProfiles(), loadProjects(), loadProjectMembers(), loadProjectTasks()]);
  render();

  sb.channel('projects-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, async () => {
      await loadProjects(); render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, async () => {
      await loadProjectMembers(); render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => {
      await loadProjectTasks(); render();
    })
    .subscribe();
})();

async function loadProfiles() {
  const data = await window.gcbtp.cache.getProfiles();
  state.profilesById = Object.fromEntries((data || []).map(p => [p.id, p]));
}

async function loadProjects() {
  const { data, error } = await sb.from('projects').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  state.projects = data || [];
}

async function loadProjectMembers() {
  const { data } = await sb.from('project_members').select('*');
  state.members = {};
  (data || []).forEach(m => {
    (state.members[m.project_id] ||= []).push(m.user_id);
  });
}

async function loadProjectTasks() {
  const { data } = await sb.from('tasks').select('id, project_id, status').not('project_id', 'is', null);
  state.tasksByProject = {};
  (data || []).forEach(t => {
    (state.tasksByProject[t.project_id] ||= []).push(t);
  });
}

function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Filtres
  document.getElementById('projStatus').addEventListener('change', (e) => {
    state.filterStatus = e.target.value;
    render();
  });
  let searchTimer;
  document.getElementById('projSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim().toLowerCase();
      render();
    }, 150);
  });

  // Modal nouveau projet
  document.getElementById('newProjBtn').addEventListener('click', openNewProjModal);
  document.getElementById('newProjClose').addEventListener('click', closeNewProjModal);
  document.getElementById('newProjCancel').addEventListener('click', closeNewProjModal);
  document.getElementById('newProjModal').addEventListener('click', (e) => {
    if (e.target.id === 'newProjModal') closeNewProjModal();
  });
  document.getElementById('newProjForm').addEventListener('submit', onNewProjectSubmit);

  // Click sur une carte projet → détail
  document.getElementById('projectsList').addEventListener('click', (e) => {
    const card = e.target.closest('.proj-card');
    if (!card) return;
    location.href = `project.html?id=${card.dataset.projectId}`;
  });
}

// ----------------------------------------------------------
// Rendu
// ----------------------------------------------------------
function render() {
  const list = document.getElementById('projectsList');
  let visible = state.projects.slice();

  if (state.filterStatus !== 'all') {
    visible = visible.filter(p => p.status === state.filterStatus);
  }
  if (state.search) {
    const q = state.search;
    visible = visible.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.client || '').toLowerCase().includes(q) ||
      (p.location || '').toLowerCase().includes(q)
    );
  }

  if (!visible.length) {
    list.innerHTML = state.search
      ? '<p class="empty">Aucun projet ne correspond à la recherche.</p>'
      : '<p class="empty">Aucun projet ' + statusLabel(state.filterStatus).toLowerCase() + '.</p>';
    window.gcbtp?.renderIcons?.();
    return;
  }

  list.innerHTML = visible.map(renderCard).join('');
  window.gcbtp?.renderIcons?.();
}

function renderCard(p) {
  const tasks = state.tasksByProject[p.id] || [];
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const memberIds = state.members[p.id] || [];
  const memberStack = memberIds.slice(0, 5).map(uid => {
    const profile = state.profilesById[uid];
    if (!profile) return '';
    const ini = initialsOf(profile.full_name);
    return `<span class="proj-member-avatar" title="${escapeAttr(profile.full_name || '')}">${escapeHtml(ini)}</span>`;
  }).join('');
  const more = memberIds.length > 5 ? `<span class="proj-member-avatar proj-member-more">+${memberIds.length - 5}</span>` : '';

  const dates = (p.start_date || p.end_date)
    ? `<span class="proj-card-meta-item"><i data-lucide="calendar"></i> ${formatDateRange(p.start_date, p.end_date)}</span>`
    : '';
  const loc = p.location ? `<span class="proj-card-meta-item"><i data-lucide="map-pin"></i> ${escapeHtml(p.location)}</span>` : '';
  const client = p.client ? `<span class="proj-card-meta-item"><i data-lucide="user"></i> ${escapeHtml(p.client)}</span>` : '';

  return `
    <div class="proj-card" data-project-id="${p.id}">
      <div class="proj-card-head">
        <h3 class="proj-card-name">${escapeHtml(p.name)}</h3>
        <span class="proj-card-status proj-status-${p.status}">${statusLabel(p.status)}</span>
      </div>
      ${p.description ? `<p class="proj-card-desc">${escapeHtml(p.description)}</p>` : ''}
      <div class="proj-card-meta">${client}${loc}${dates}</div>
      <div class="proj-card-progress" title="${done} sur ${total} tâches terminées">
        <div class="proj-gauge"><div class="proj-gauge-fill" style="width:${pct}%"></div></div>
        <span class="proj-card-pct">${done}/${total} · ${pct}%</span>
      </div>
      <div class="proj-card-team">
        <div class="proj-member-stack">${memberStack}${more}</div>
        <span class="proj-card-cta">Ouvrir <i data-lucide="arrow-right"></i></span>
      </div>
    </div>`;
}

function statusLabel(s) {
  const labels = { active: 'Actifs', done: 'Terminés', on_hold: 'En pause', cancelled: 'Annulés', all: 'Tous' };
  return labels[s] || s;
}

// ----------------------------------------------------------
// Modal nouveau projet
// ----------------------------------------------------------
function openNewProjModal() {
  document.getElementById('newProjForm').reset();
  document.getElementById('newProjModal').hidden = false;
}
function closeNewProjModal() {
  document.getElementById('newProjModal').hidden = true;
}

async function onNewProjectSubmit(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const submit = f.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    const { data: projectId, error } = await sb.rpc('create_project_with_setup', {
      p_name:        f.name.value.trim(),
      p_description: f.description.value.trim() || null,
      p_client:      f.client.value.trim() || null,
      p_location:    f.location.value.trim() || null,
      p_start_date:  f.start_date.value || null,
      p_end_date:    f.end_date.value || null
    });
    if (error) throw error;
    closeNewProjModal();
    if (projectId) location.href = `project.html?id=${projectId}`;
  } catch (e) {
    alert('Erreur : ' + e.message);
  } finally {
    submit.disabled = false;
  }
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------
function initialsOf(s) {
  const parts = String(s || '').trim().split(/\s+/);
  if (!parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function formatDateRange(s, e) {
  const fmt = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  if (s && e) return `${fmt(s)} → ${fmt(e)}`;
  if (s) return `Démarré ${fmt(s)}`;
  if (e) return `Échéance ${fmt(e)}`;
  return '';
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
})();
