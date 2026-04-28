// =========================================================
// GCBTP — Page Avancement (Gantt par projet)
// Remplace l'ancienne vue calendrier mensuelle.
// =========================================================
(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

const state = {
  me: null,
  tasks: [],
  assigneesByTask: {},   // task_id → [user_id]
  profilesById: {},
  filterStatus: 'all',   // 'all' | 'active' | 'late'
  filterMember: 'all'    // user_id | 'all'
};

(async () => {
  const session = await requireAuth();
  if (!session) return;
  state.me = await currentProfile();
  document.getElementById('userName').textContent = state.me?.full_name || session.user.email;

  bindUI();
  await Promise.all([loadProfiles(), loadTasks(), loadAssignees()]);
  populateMemberFilter();
  render();

  // Realtime : refresh sur tout changement de tâche
  sb.channel('progress-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => {
      await loadTasks();
      render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, async () => {
      await loadAssignees();
      render();
    })
    .subscribe();
})();

async function loadProfiles() {
  const data = await window.gcbtp.cache.getProfiles();
  state.profilesById = Object.fromEntries((data || []).map(p => [p.id, p]));
}

async function loadTasks() {
  const { data } = await sb.from('tasks').select('*');
  state.tasks = data || [];
  document.getElementById('progressUpdated').textContent =
    `Mis à jour ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

async function loadAssignees() {
  const { data } = await sb.from('task_assignees').select('*');
  state.assigneesByTask = {};
  (data || []).forEach(a => {
    (state.assigneesByTask[a.task_id] ||= []).push(a.user_id);
  });
}

function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('progressFilter').addEventListener('change', (e) => {
    state.filterStatus = e.target.value;
    render();
  });
  document.getElementById('progressMember').addEventListener('change', (e) => {
    state.filterMember = e.target.value;
    render();
  });
}

function populateMemberFilter() {
  const sel = document.getElementById('progressMember');
  const others = Object.values(state.profilesById)
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  sel.innerHTML = '<option value="all">Toute l\'équipe</option>' +
    others.map(p => `<option value="${p.id}">${escapeHtml(p.full_name || 'Sans nom')}</option>`).join('');
}

// ----------------------------------------------------------
// Rendu principal : groupement par projet, Gantt par section
// ----------------------------------------------------------
function render() {
  const list = document.getElementById('progressList');

  let tasks = state.tasks.slice();
  if (state.filterMember !== 'all') {
    tasks = tasks.filter(t => (state.assigneesByTask[t.id] || []).includes(state.filterMember));
  }

  // Grouper par projet (champ texte). Sans projet = "(Sans chantier)"
  const groups = {};
  tasks.forEach(t => {
    const key = (t.project || '').trim() || '(Sans chantier)';
    (groups[key] ||= []).push(t);
  });

  const today = todayIso();
  const groupsArr = Object.entries(groups).map(([project, ts]) => ({
    project,
    tasks: ts,
    stats: computeStats(ts, today)
  }));

  let visible = groupsArr;
  if (state.filterStatus === 'active') {
    visible = visible.filter(g => g.stats.inProgress > 0 || g.stats.todo > 0);
  } else if (state.filterStatus === 'late') {
    visible = visible.filter(g => g.stats.overdue > 0);
  }

  // Tri : retards en haut, puis en cours, puis ordre alpha
  visible.sort((a, b) => {
    if (b.stats.overdue !== a.stats.overdue) return b.stats.overdue - a.stats.overdue;
    if (b.stats.inProgress !== a.stats.inProgress) return b.stats.inProgress - a.stats.inProgress;
    return a.project.localeCompare(b.project);
  });

  if (!visible.length) {
    list.innerHTML = '<p class="empty">Aucun chantier ne correspond aux filtres.</p>';
    window.gcbtp?.renderIcons?.();
    return;
  }

  list.innerHTML = visible.map(renderProject).join('');
  window.gcbtp?.renderIcons?.();
}

function computeStats(tasks, today) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const todo = tasks.filter(t => t.status === 'todo').length;
  const overdue = tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < today).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, inProgress, todo, overdue, pct };
}

function renderProject(g) {
  const { project, tasks, stats } = g;
  const today = todayIso();

  // Plage temporelle du projet
  const allDates = [];
  tasks.forEach(t => {
    const start = (t.created_at || '').slice(0, 10);
    const end = t.due_date || (t.status === 'done' ? (t.updated_at || '').slice(0, 10) : today);
    if (start) allDates.push(start);
    if (end) allDates.push(end);
  });
  if (!allDates.length) return '';

  const minDate = allDates.reduce((a, b) => a < b ? a : b);
  let maxDate = allDates.reduce((a, b) => a > b ? a : b);
  if (maxDate < today) maxDate = today;
  const range = Math.max(daysBetween(minDate, maxDate), 1);
  const padded = addDays(maxDate, Math.max(2, Math.round(range * 0.05)));

  const sorted = tasks.slice().sort((a, b) => {
    if (!a.due_date && !b.due_date) return new Date(a.created_at) - new Date(b.created_at);
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });

  const todayPct = pctOf(today, minDate, padded);
  const months = monthsBetween(minDate, padded);

  return `
    <section class="proj-section">
      <header class="proj-head">
        <div class="proj-title">
          <i data-lucide="hard-hat"></i>
          <h3>${escapeHtml(project)}</h3>
          <span class="proj-count">${stats.done}/${stats.total} · ${stats.pct}%</span>
        </div>
        <div class="proj-gauge" title="${stats.done} sur ${stats.total} terminées">
          <div class="proj-gauge-fill" style="width:${stats.pct}%"></div>
        </div>
        <div class="proj-stats">
          ${stats.overdue ? `<span class="chip chip-danger"><i data-lucide="alert-triangle"></i> ${stats.overdue} en retard</span>` : ''}
          ${stats.inProgress ? `<span class="chip chip-progress"><i data-lucide="clock"></i> ${stats.inProgress} en cours</span>` : ''}
          ${stats.todo ? `<span class="chip"><i data-lucide="circle"></i> ${stats.todo} à faire</span>` : ''}
          ${stats.done ? `<span class="chip chip-done"><i data-lucide="check-circle-2"></i> ${stats.done} terminées</span>` : ''}
        </div>
      </header>
      <div class="gantt">
        <div class="gantt-axis">
          ${months.map(m => `<span class="gantt-month" style="left:${pctOf(m.iso, minDate, padded)}%">${m.label}</span>`).join('')}
          <div class="gantt-today" style="left:${todayPct}%" title="Aujourd'hui"><span class="gantt-today-label">Aujourd'hui</span></div>
        </div>
        <ul class="gantt-rows">
          ${sorted.map(t => renderGanttRow(t, minDate, padded, today)).join('')}
        </ul>
      </div>
    </section>`;
}

function renderGanttRow(task, minDate, maxDate, today) {
  const start = (task.created_at || '').slice(0, 10);
  const due = task.due_date;
  const isOverdue = task.status !== 'done' && due && due < today;
  const status = task.status === 'done' ? 'done'
                : isOverdue ? 'overdue'
                : task.status === 'in_progress' ? 'progress'
                : 'todo';

  let segEnd;
  if (task.status === 'done') {
    segEnd = (task.updated_at || '').slice(0, 10) || due || today;
  } else if (due) {
    segEnd = due;
  } else {
    segEnd = addDays(today, 7);
  }

  const left = Math.max(0, pctOf(start || today, minDate, maxDate));
  const right = pctOf(segEnd, minDate, maxDate);
  const width = Math.max(1.5, right - left);

  const assignees = (state.assigneesByTask[task.id] || [])
    .map(uid => state.profilesById[uid]?.full_name)
    .filter(Boolean);
  const assigneesAttr = assignees.length ? `Pour : ${assignees.join(', ')}` : 'Non assignée';
  const dueLabel = due ? new Date(due).toLocaleDateString('fr-FR') : 'Sans échéance';
  const tooltip = `${task.title}\n${dueLabel}\n${assigneesAttr}`;

  return `
    <li class="gantt-row gantt-row-${status}" title="${escapeAttr(tooltip)}">
      <div class="gantt-label">${escapeHtml(task.title)}</div>
      <div class="gantt-track">
        <div class="gantt-bar gantt-bar-${status}" style="left:${left}%; width:${width}%">
          <span class="gantt-bar-text">${dueLabel}</span>
        </div>
      </div>
    </li>`;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------
function todayIso() { return new Date().toISOString().slice(0, 10); }

function addDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function pctOf(iso, minIso, maxIso) {
  const total = new Date(maxIso) - new Date(minIso);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, ((new Date(iso) - new Date(minIso)) / total) * 100));
}

function monthsBetween(minIso, maxIso) {
  const out = [];
  const start = new Date(minIso);
  start.setDate(1);
  const end = new Date(maxIso);
  while (start <= end) {
    out.push({
      iso: start.toISOString().slice(0, 10),
      label: start.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    });
    start.setMonth(start.getMonth() + 1);
  }
  return out;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
})();
