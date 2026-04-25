(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

const STATUS_LABEL = {
  todo:        { label: 'À faire',  cls: 'status-todo'     },
  in_progress: { label: 'En cours', cls: 'status-progress' },
  done:        { label: 'Terminée', cls: 'status-done'     }
};
const PRIORITY_LABEL = {
  low:    { label: 'Basse',   cls: 'prio-low'    },
  medium: { label: 'Moyenne', cls: 'prio-medium' },
  high:   { label: 'Haute',   cls: 'prio-high'   }
};

const state = {
  me: null,
  tasks: [],
  assigneesByTask: {},
  profilesById: {},
  cursor: new Date(),
  filter: 'all',
  selectedKey: null
};

(async () => {
  const session = await requireAuth();
  if (!session) return;
  bindUI();
  state.me = await currentProfile();
  document.getElementById('userName').textContent = state.me?.full_name || session.user.email;

  await Promise.all([loadProfiles(), loadAssignees(), loadTasks()]);
  render();

  sb.channel('cal-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => { await loadTasks(); render(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, async () => { await loadAssignees(); render(); })
    .subscribe();
})();

async function loadProfiles() {
  const { data } = await sb.from('profiles').select('id, full_name');
  state.profilesById = Object.fromEntries((data || []).map(p => [p.id, p]));
}
async function loadAssignees() {
  const { data } = await sb.from('task_assignees').select('task_id, user_id');
  const map = {};
  (data || []).forEach(r => { (map[r.task_id] ||= []).push(r.user_id); });
  state.assigneesByTask = map;
}
async function loadTasks() {
  const { data } = await sb.from('tasks').select('*').not('due_date', 'is', null);
  state.tasks = data || [];
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function tasksOnDay(key) {
  return state.tasks.filter(t => {
    if (!t.due_date) return false;
    const k = (t.due_date || '').slice(0, 10);
    if (k !== key) return false;
    if (state.filter === 'me') return (state.assigneesByTask[t.id] || []).includes(state.me?.id);
    return true;
  });
}

function render() {
  const cur = state.cursor;
  const year = cur.getFullYear();
  const month = cur.getMonth();
  document.getElementById('calTitle').textContent =
    new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      .replace(/^./, c => c.toUpperCase());

  // Premier jour du mois aligné Lundi (ISO 8601)
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Lundi=0
  const start = new Date(year, month, 1 - offset);

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  const today = new Date(); const todayKey = dayKey(today);

  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const inMonth = d.getMonth() === month;
    const key = dayKey(d);
    const tasksHere = tasksOnDay(key);

    const cell = document.createElement('div');
    cell.className = `cal-cell ${inMonth ? '' : 'cal-cell-off'} ${key === todayKey ? 'cal-cell-today' : ''} ${key === state.selectedKey ? 'cal-cell-selected' : ''}`;
    cell.dataset.key = key;

    let dotsHtml = '';
    if (tasksHere.length > 0) {
      const overdueCount = tasksHere.filter(t => t.status !== 'done' && new Date(t.due_date) < new Date(today.toDateString())).length;
      const counts = { todo: 0, in_progress: 0, done: 0 };
      tasksHere.forEach(t => counts[t.status]++);
      const dots = [];
      if (overdueCount > 0) dots.push(`<span class="dot dot-overdue" title="${overdueCount} en retard"></span>`);
      if (counts.todo > 0) dots.push(`<span class="dot dot-todo" title="${counts.todo} à faire"></span>`);
      if (counts.in_progress > 0) dots.push(`<span class="dot dot-progress" title="${counts.in_progress} en cours"></span>`);
      if (counts.done > 0) dots.push(`<span class="dot dot-done" title="${counts.done} terminées"></span>`);
      dotsHtml = `<div class="cal-cell-dots">${dots.join('')}</div>`;
      if (tasksHere.length > 3) dotsHtml += `<div class="cal-cell-count">+${tasksHere.length - 3}</div>`;
    }

    cell.innerHTML = `
      <span class="cal-cell-day">${d.getDate()}</span>
      ${dotsHtml}
    `;
    grid.appendChild(cell);
  }

  renderDayPanel();
}

function renderDayPanel() {
  const panel = document.getElementById('dayPanel');
  if (!state.selectedKey) { panel.hidden = true; return; }
  const tasks = tasksOnDay(state.selectedKey);
  const dateLabel = new Date(state.selectedKey).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('dayTitle').textContent = `📅 ${dateLabel.replace(/^./, c => c.toUpperCase())}`;
  const box = document.getElementById('dayTasks');
  if (tasks.length === 0) {
    box.innerHTML = '<p class="empty">Aucune tâche pour ce jour.</p>';
    panel.hidden = false;
    return;
  }
  box.innerHTML = tasks.map(t => {
    const st = STATUS_LABEL[t.status];
    const pr = PRIORITY_LABEL[t.priority];
    const assignees = (state.assigneesByTask[t.id] || []).map(uid => state.profilesById[uid]?.full_name).filter(Boolean);
    return `
      <a class="cal-day-task" href="dashboard.html#task-${t.id}">
        <div class="cal-day-task-head">
          <h4>${escapeHtml(t.title)}</h4>
          <span class="status-pill ${st.cls}">${st.label}</span>
        </div>
        <div class="cal-day-task-meta">
          <span class="badge ${pr.cls}">${pr.label}</span>
          ${t.project ? `<span class="chip">🏗️ ${escapeHtml(t.project)}</span>` : ''}
          ${assignees.length > 0 ? `<span class="chip">👥 ${escapeHtml(assignees.join(', '))}</span>` : ''}
        </div>
      </a>`;
  }).join('');
  panel.hidden = false;
}

function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('calPrev').addEventListener('click', () => {
    state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
    render();
  });
  document.getElementById('calNext').addEventListener('click', () => {
    state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
    render();
  });
  document.getElementById('calToday').addEventListener('click', () => {
    state.cursor = new Date();
    state.selectedKey = dayKey(new Date());
    render();
  });
  document.getElementById('calFilter').addEventListener('change', (e) => {
    state.filter = e.target.value;
    render();
  });
  document.getElementById('calGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (!cell) return;
    state.selectedKey = state.selectedKey === cell.dataset.key ? null : cell.dataset.key;
    render();
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
})();
