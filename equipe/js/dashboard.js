(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

const STATUS_LABEL = {
  todo:        { label: 'À faire',   cls: 'status-todo'    },
  in_progress: { label: 'En cours',  cls: 'status-progress'},
  done:        { label: 'Terminée',  cls: 'status-done'    }
};
const PRIORITY_LABEL = {
  low:    { label: 'Basse', cls: 'prio-low'    },
  medium: { label: 'Moyenne', cls: 'prio-medium' },
  high:   { label: 'Haute', cls: 'prio-high'   }
};

let state = {
  me: null,
  profiles: [],
  profilesById: {},
  tasks: [],
  filters: { assignee: 'all', status: 'all' },
  openTaskId: null,
  commentsChannel: null
};

// ---------- Init ----------
(async () => {
  const session = await requireAuth();
  if (!session) return;

  // Attacher les handlers UI IMMÉDIATEMENT pour éviter les submits en GET
  // si l'utilisateur est plus rapide que les requêtes réseau
  bindUI();

  state.me = await currentProfile();
  document.getElementById('userName').textContent = state.me?.full_name || session.user.email;
  if (state.me?.role === 'admin') document.getElementById('newTaskBtn').hidden = false;

  await Promise.all([loadProfiles(), loadTasks()]);
  renderAll();

  // Realtime : rafraîchir à chaque changement de la table tasks
  sb.channel('tasks-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => {
      await loadTasks();
      renderAll();
    })
    .subscribe();
})();

// ---------- Data ----------
async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('*').order('full_name');
  if (error) { console.error(error); return; }
  state.profiles = data || [];
  state.profilesById = Object.fromEntries(state.profiles.map(p => [p.id, p]));
}
async function loadTasks() {
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  state.tasks = data || [];
}

// ---------- Render ----------
function renderAll() {
  renderAssigneeFilter();
  renderStats();
  renderTeamProgress();
  renderTasks();
}

function renderAssigneeFilter() {
  const sel = document.getElementById('filterAssignee');
  const current = sel.value || 'all';
  sel.innerHTML =
    '<option value="all">Tous les membres</option>' +
    '<option value="me">Mes tâches</option>' +
    state.profiles.map(p => `<option value="${p.id}">${escapeHtml(p.full_name)}</option>`).join('');
  sel.value = current;
}

function renderStats() {
  const total = state.tasks.length;
  const done  = state.tasks.filter(t => t.status === 'done').length;
  const prog  = state.tasks.filter(t => t.status === 'in_progress').length;
  const todo  = state.tasks.filter(t => t.status === 'todo').length;
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statTodo').textContent  = todo;
  document.getElementById('statProg').textContent  = prog;
  document.getElementById('statDone').textContent  = done;
}

function renderTeamProgress() {
  const box = document.getElementById('teamProgress');
  box.innerHTML = state.profiles.map(p => {
    const mine = state.tasks.filter(t => t.assignee_id === p.id);
    const total = mine.length;
    const done  = mine.filter(t => t.status === 'done').length;
    const pct = total === 0 ? 0 : Math.round((done/total)*100);
    return `
      <div class="progress-row">
        <div class="progress-head">
          <span class="progress-name">${escapeHtml(p.full_name)}</span>
          <span class="progress-count">${done}/${total}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('') || '<p class="empty">Aucun membre pour le moment.</p>';
}

function renderTasks() {
  const container = document.getElementById('tasksList');
  const { assignee, status } = state.filters;
  let tasks = state.tasks;
  if (assignee === 'me')        tasks = tasks.filter(t => t.assignee_id === state.me.id);
  else if (assignee !== 'all')  tasks = tasks.filter(t => t.assignee_id === assignee);
  if (status !== 'all')          tasks = tasks.filter(t => t.status === status);

  if (tasks.length === 0) {
    container.innerHTML = '<p class="empty">Aucune tâche.</p>';
    return;
  }

  container.innerHTML = tasks.map(t => {
    const st = STATUS_LABEL[t.status];
    const pr = PRIORITY_LABEL[t.priority];
    const assignee = state.profiles.find(p => p.id === t.assignee_id);
    const due = t.due_date ? new Date(t.due_date).toLocaleDateString('fr-FR') : '';
    const overdue = t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date(new Date().toDateString());
    return `
      <article class="task-card" data-id="${t.id}">
        <div class="task-head">
          <h3 class="task-title task-open" data-id="${t.id}">${escapeHtml(t.title)}</h3>
          <span class="badge ${pr.cls}">${pr.label}</span>
        </div>
        ${t.description ? `<p class="task-desc">${escapeHtml(t.description)}</p>` : ''}
        <div class="task-meta">
          ${t.project ? `<span class="chip">🏗️ ${escapeHtml(t.project)}</span>` : ''}
          ${assignee ? `<span class="chip">👤 ${escapeHtml(assignee.full_name)}</span>` : '<span class="chip chip-muted">Non assignée</span>'}
          ${due ? `<span class="chip ${overdue ? 'chip-danger' : ''}">📅 ${due}</span>` : ''}
        </div>
        <div class="task-actions">
          <select class="task-status ${st.cls}" data-id="${t.id}">
            <option value="todo" ${t.status==='todo'?'selected':''}>À faire</option>
            <option value="in_progress" ${t.status==='in_progress'?'selected':''}>En cours</option>
            <option value="done" ${t.status==='done'?'selected':''}>Terminée</option>
          </select>
          <button class="btn-ghost btn-comment" data-id="${t.id}">💬 Discussion</button>
          <button class="btn-ghost btn-edit" data-id="${t.id}">Modifier</button>
          ${state.me?.role === 'admin' ? `<button class="btn-ghost btn-danger btn-delete" data-id="${t.id}">Supprimer</button>` : ''}
        </div>
      </article>`;
  }).join('');
}

// ---------- UI bindings ----------
function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  document.getElementById('filterAssignee').addEventListener('change', (e) => {
    state.filters.assignee = e.target.value;
    renderTasks();
  });
  document.getElementById('filterStatus').addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    renderTasks();
  });

  // Changement de statut rapide
  document.getElementById('tasksList').addEventListener('change', async (e) => {
    if (!e.target.classList.contains('task-status')) return;
    const id = e.target.dataset.id;
    const newStatus = e.target.value;
    const { error } = await sb.from('tasks').update({ status: newStatus }).eq('id', id);
    if (error) alert('Erreur: ' + error.message);
  });

  // Modifier / supprimer / ouvrir détail
  document.getElementById('tasksList').addEventListener('click', async (e) => {
    const editBtn    = e.target.closest('.btn-edit');
    const delBtn     = e.target.closest('.btn-delete');
    const commentBtn = e.target.closest('.btn-comment');
    const titleBtn   = e.target.closest('.task-open');
    if (editBtn) {
      const task = state.tasks.find(t => t.id === editBtn.dataset.id);
      openTaskModal(task);
      return;
    }
    if (delBtn) {
      if (!confirm('Supprimer cette tâche ?')) return;
      const { error } = await sb.from('tasks').delete().eq('id', delBtn.dataset.id);
      if (error) alert('Erreur: ' + error.message);
      return;
    }
    if (commentBtn || titleBtn) {
      const id = (commentBtn || titleBtn).dataset.id;
      openTaskDetail(id);
    }
  });

  document.getElementById('newTaskBtn').addEventListener('click', () => openTaskModal());
  document.getElementById('modalCancel').addEventListener('click', closeTaskModal);
  document.getElementById('taskForm').addEventListener('submit', onTaskSubmit);

  // Modal détail tâche
  document.getElementById('detailClose').addEventListener('click', closeTaskDetail);
  document.getElementById('taskDetailModal').addEventListener('click', (e) => {
    if (e.target.id === 'taskDetailModal') closeTaskDetail();
  });
  document.getElementById('commentForm').addEventListener('submit', onCommentSubmit);
  document.getElementById('commentInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('commentForm').requestSubmit();
    }
  });
  document.getElementById('commentsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.comment-delete');
    if (!btn) return;
    if (!confirm('Supprimer ce commentaire ?')) return;
    const { error } = await sb.from('task_comments').delete().eq('id', btn.dataset.id);
    if (error) alert('Erreur: ' + error.message);
  });

  // Clic sur l'overlay (hors du contenu) ferme la modal
  document.getElementById('taskModal').addEventListener('click', (e) => {
    if (e.target.id === 'taskModal') closeTaskModal();
  });
  // Touche Échap ferme toute modal ouverte
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTaskModal();
      closeTaskDetail();
    }
  });
}

// ---------- Détail tâche + commentaires ----------
async function openTaskDetail(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  state.openTaskId = taskId;

  const assignee = state.profilesById[task.assignee_id];
  const due = task.due_date ? new Date(task.due_date).toLocaleDateString('fr-FR') : '—';
  const st = STATUS_LABEL[task.status];
  const pr = PRIORITY_LABEL[task.priority];

  document.getElementById('taskDetailHead').innerHTML = `
    <div class="detail-head">
      <h3>${escapeHtml(task.title)}</h3>
      <div class="detail-chips">
        <span class="badge ${pr.cls}">${pr.label}</span>
        <span class="chip ${st.cls}">${st.label}</span>
        ${task.project ? `<span class="chip">🏗️ ${escapeHtml(task.project)}</span>` : ''}
        <span class="chip">👤 ${escapeHtml(assignee?.full_name || 'Non assignée')}</span>
        <span class="chip">📅 ${due}</span>
      </div>
      ${task.description ? `<p class="detail-desc">${escapeHtml(task.description)}</p>` : ''}
    </div>`;

  const modal = document.getElementById('taskDetailModal');
  modal.removeAttribute('hidden');
  modal.style.display = 'flex';

  await loadComments(taskId);

  // Realtime sur task_comments pour cette tâche
  if (state.commentsChannel) await state.commentsChannel.unsubscribe();
  state.commentsChannel = sb.channel(`comments-${taskId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
      (payload) => appendComment(payload.new, true)
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
      (payload) => {
        const el = document.querySelector(`[data-comment-id="${payload.old.id}"]`);
        if (el) el.remove();
      }
    )
    .subscribe();
}

async function closeTaskDetail() {
  const modal = document.getElementById('taskDetailModal');
  modal.style.display = 'none';
  modal.setAttribute('hidden', '');
  state.openTaskId = null;
  if (state.commentsChannel) { await state.commentsChannel.unsubscribe(); state.commentsChannel = null; }
}

async function loadComments(taskId) {
  const list = document.getElementById('commentsList');
  list.innerHTML = '<p class="empty">Chargement…</p>';
  const { data, error } = await sb
    .from('task_comments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) { list.innerHTML = '<p class="empty">Erreur de chargement.</p>'; return; }
  list.innerHTML = '';
  if (!data || data.length === 0) {
    list.innerHTML = '<p class="empty">Aucun commentaire pour le moment. Sois le premier à en ajouter.</p>';
    return;
  }
  data.forEach(c => appendComment(c, false));
}

function appendComment(c, animate) {
  const list = document.getElementById('commentsList');
  // Retirer l'éventuel message vide
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();
  // Éviter les doublons
  if (list.querySelector(`[data-comment-id="${c.id}"]`)) return;
  const author = state.profilesById[c.user_id]?.full_name || 'Inconnu';
  const mine = c.user_id === state.me?.id;
  const when = new Date(c.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = `comment ${mine ? 'comment-mine' : ''} ${animate ? 'comment-new' : ''}`;
  div.dataset.commentId = c.id;
  div.innerHTML = `
    <div class="comment-head">
      <span class="comment-author">${escapeHtml(author)}</span>
      <span class="comment-time">${when}</span>
      ${mine ? `<button class="comment-delete" data-id="${c.id}" title="Supprimer">×</button>` : ''}
    </div>
    <div class="comment-content">${escapeHtml(c.content).replace(/\n/g, '<br>')}</div>`;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

async function onCommentSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('commentInput');
  const content = input.value.trim();
  if (!content || !state.openTaskId || !state.me) return;
  input.value = '';
  const { error } = await sb.from('task_comments').insert({
    task_id: state.openTaskId,
    user_id: state.me.id,
    content
  });
  if (error) alert('Erreur: ' + error.message);
}

// ---------- Modal tâche ----------
function openTaskModal(task = null) {
  document.getElementById('modalTitle').textContent = task ? 'Modifier la tâche' : 'Nouvelle tâche';
  const f = document.getElementById('taskForm');
  f.dataset.id = task?.id || '';
  f.title.value       = task?.title || '';
  f.description.value = task?.description || '';
  f.project.value     = task?.project || '';
  f.priority.value    = task?.priority || 'medium';
  f.status.value      = task?.status || 'todo';
  f.due_date.value    = task?.due_date || '';
  f.assignee_id.innerHTML =
    '<option value="">— Non assignée —</option>' +
    state.profiles.map(p => `<option value="${p.id}" ${task?.assignee_id===p.id?'selected':''}>${escapeHtml(p.full_name)}</option>`).join('');
  const modal = document.getElementById('taskModal');
  modal.removeAttribute('hidden');
  modal.style.display = 'flex';
}
function closeTaskModal() {
  const modal = document.getElementById('taskModal');
  modal.style.display = 'none';
  modal.setAttribute('hidden', '');
}
async function onTaskSubmit(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const payload = {
    title:       f.title.value.trim(),
    description: f.description.value.trim() || null,
    project:     f.project.value.trim() || null,
    priority:    f.priority.value,
    status:      f.status.value,
    due_date:    f.due_date.value || null,
    assignee_id: f.assignee_id.value || null
  };
  if (!payload.title) { alert('Titre requis'); return; }

  let error;
  if (f.dataset.id) {
    ({ error } = await sb.from('tasks').update(payload).eq('id', f.dataset.id));
  } else {
    payload.created_by = state.me.id;
    ({ error } = await sb.from('tasks').insert(payload));
  }
  if (error) { alert('Erreur: ' + error.message); return; }
  closeTaskModal();
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
})();
