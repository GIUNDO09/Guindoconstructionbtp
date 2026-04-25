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
  assigneesByTask: {},  // { taskId: [userId, userId, ...] }
  folders: [],
  serverUrl: null,
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

  await Promise.all([loadProfiles(), loadTasks(), loadAssignees(), loadFolders(), loadServerUrl()]);
  renderAll();

  // Realtime : rafraîchir à chaque changement
  sb.channel('tasks-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => {
      await loadTasks();
      renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, async () => {
      await loadAssignees();
      renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'folders' }, async () => {
      await loadFolders();
      renderAll();
    })
    .subscribe();
})();

async function loadAssignees() {
  const { data, error } = await sb.from('task_assignees').select('*');
  if (error) { console.error(error); return; }
  state.assigneesByTask = {};
  (data || []).forEach(r => {
    (state.assigneesByTask[r.task_id] ||= []).push(r.user_id);
  });
}

async function loadFolders() {
  const { data, error } = await sb.from('folders').select('id, name, parent_id').order('name');
  if (error) { console.error(error); return; }
  state.folders = data || [];
}

async function loadServerUrl() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'file_server_url').maybeSingle();
  state.serverUrl = data?.value || null;
}

// Construit le chemin complet d'un dossier (pour affichage dans le select)
function folderBreadcrumb(folderId) {
  const parts = [];
  let id = folderId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const f = state.folders.find(x => x.id === id);
    if (!f) break;
    parts.unshift(f.name);
    id = f.parent_id;
  }
  return parts.join(' / ');
}

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

function assigneesOf(taskId) {
  return (state.assigneesByTask[taskId] || [])
    .map(uid => state.profilesById[uid])
    .filter(Boolean);
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
    const mine = state.tasks.filter(t => (state.assigneesByTask[t.id] || []).includes(p.id));
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
  if (assignee === 'me')        tasks = tasks.filter(t => (state.assigneesByTask[t.id] || []).includes(state.me.id));
  else if (assignee !== 'all')  tasks = tasks.filter(t => (state.assigneesByTask[t.id] || []).includes(assignee));
  if (status !== 'all')          tasks = tasks.filter(t => t.status === status);

  if (tasks.length === 0) {
    container.innerHTML = '<p class="empty">Aucune tâche.</p>';
    return;
  }

  container.innerHTML = tasks.map(t => {
    const st = STATUS_LABEL[t.status];
    const pr = PRIORITY_LABEL[t.priority];
    const taskAssignees = assigneesOf(t.id);
    const due = t.due_date ? new Date(t.due_date).toLocaleDateString('fr-FR') : '';
    const overdue = t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date(new Date().toDateString());
    const coverUrl = (t.cover_file_id && state.serverUrl) ? `${state.serverUrl}/stream/${t.cover_file_id}` : null;

    const assigneesHtml = taskAssignees.length === 0
      ? '<span class="row-assignee-empty">Non assignée</span>'
      : taskAssignees.slice(0, 4).map(p =>
          `<span class="row-avatar" title="${escapeHtml(p.full_name)}">${escapeHtml(initials(p.full_name))}</span>`
        ).join('') + (taskAssignees.length > 4 ? `<span class="row-avatar row-avatar-more">+${taskAssignees.length - 4}</span>` : '');

    return `
      <div class="task-row task-open" data-id="${t.id}">
        <div class="row-cover">
          ${coverUrl
            ? `<img src="${coverUrl}" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('row-cover-empty')">`
            : `<span class="row-cover-icon">📋</span>`}
        </div>
        <div class="row-main">
          <div class="row-title-line">
            <h3 class="row-title">${escapeHtml(t.title)}</h3>
            <span class="status-pill ${st.cls}">${st.label}</span>
          </div>
          <div class="row-meta">
            <span class="badge ${pr.cls}">${pr.label}</span>
            ${t.project ? `<span class="chip">🏗️ ${escapeHtml(t.project)}</span>` : ''}
            ${due ? `<span class="chip ${overdue ? 'chip-danger' : ''}">📅 ${due}</span>` : ''}
          </div>
        </div>
        <div class="row-assignees">${assigneesHtml}</div>
        <div class="row-chevron">›</div>
      </div>`;
  }).join('');
}

function initials(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function firstName(full) {
  return String(full || '').split(/\s+/)[0];
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

  const taskAssignees = assigneesOf(task.id);
  const due = task.due_date ? new Date(task.due_date).toLocaleDateString('fr-FR') : null;
  const st = STATUS_LABEL[task.status];
  const pr = PRIORITY_LABEL[task.priority];
  const coverUrl = (task.cover_file_id && state.serverUrl) ? `${state.serverUrl}/stream/${task.cover_file_id}` : null;
  const folder = task.folder_id ? state.folders.find(f => f.id === task.folder_id) : null;
  const created  = task.created_at ? new Date(task.created_at) : null;
  const updated  = task.updated_at ? new Date(task.updated_at) : null;
  const overdue  = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date(new Date().toDateString());

  const progressPct = task.status === 'todo' ? 0 : task.status === 'in_progress' ? 50 : 100;
  const creatorName = state.profilesById[task.created_by]?.full_name || '—';

  const assigneesHtml = taskAssignees.length === 0
    ? '<span class="chip chip-muted">Non assignée</span>'
    : taskAssignees.map(p => `<span class="chip-pill">👤 ${escapeHtml(p.full_name)}</span>`).join('');

  const isAdmin = state.me?.role === 'admin';

  document.getElementById('taskDetailHead').innerHTML = `
    ${coverUrl ? `<div class="detail-cover"><img src="${coverUrl}" alt="" onerror="this.parentElement.style.display='none'"></div>` : ''}
    <div class="detail-head">
      <h3>${escapeHtml(task.title)}</h3>
      <div class="detail-chips">
        <span class="badge ${pr.cls}">${pr.label}</span>
        ${task.project ? `<span class="chip">🏗️ ${escapeHtml(task.project)}</span>` : ''}
        ${folder ? `<a class="chip chip-folder" href="files.html">📁 ${escapeHtml(folder.name)}</a>` : ''}
        ${due ? `<span class="chip ${overdue ? 'chip-danger' : ''}">📅 ${due}${overdue ? ' (en retard)' : ''}</span>` : ''}
      </div>

      <div class="detail-section">
        <h4>Avancement</h4>
        <div class="progress-block">
          <div class="progress-bar progress-bar-lg"><div class="progress-fill" style="width:${progressPct}%"></div></div>
          <span class="progress-pct">${progressPct}%</span>
        </div>
        <div class="status-buttons" data-task-id="${task.id}">
          <button class="status-btn ${task.status==='todo'?'status-btn-active':''}" data-status="todo">📝 À faire</button>
          <button class="status-btn ${task.status==='in_progress'?'status-btn-active':''}" data-status="in_progress">⚙️ En cours</button>
          <button class="status-btn ${task.status==='done'?'status-btn-active':''}" data-status="done">✅ Terminée</button>
        </div>
      </div>

      <div class="detail-section">
        <h4>Assignées à</h4>
        <div class="detail-chips">${assigneesHtml}</div>
      </div>

      ${task.description ? `
        <div class="detail-section">
          <h4>Description</h4>
          <p class="detail-desc">${escapeHtml(task.description).replace(/\n/g, '<br>')}</p>
        </div>` : ''}

      <div class="detail-section">
        <h4>Timeline</h4>
        <ul class="timeline">
          ${created ? `<li><span class="tl-icon">🟢</span><span class="tl-text"><strong>Créée</strong> par ${escapeHtml(creatorName)} le ${created.toLocaleDateString('fr-FR')} à ${created.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}</span></li>` : ''}
          ${updated && created && updated.getTime() !== created.getTime() ? `<li><span class="tl-icon">🔄</span><span class="tl-text"><strong>Dernière modification</strong> le ${updated.toLocaleDateString('fr-FR')} à ${updated.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}</span></li>` : ''}
          ${due ? `<li><span class="tl-icon">${overdue ? '⚠️' : '📅'}</span><span class="tl-text"><strong>Échéance</strong> ${due}${overdue ? ' — <span class="tl-overdue">en retard</span>' : ''}</span></li>` : ''}
          ${task.status === 'done' && updated ? `<li><span class="tl-icon">✅</span><span class="tl-text"><strong>Marquée terminée</strong> le ${updated.toLocaleDateString('fr-FR')}</span></li>` : ''}
        </ul>
      </div>

      <div class="detail-actions">
        <button class="btn-ghost" id="detailEdit">✏️ Modifier</button>
        ${isAdmin ? `<button class="btn-ghost btn-danger" id="detailDelete">🗑 Supprimer</button>` : ''}
      </div>
    </div>`;

  // Lier les nouveaux boutons
  const detailHead = document.getElementById('taskDetailHead');
  detailHead.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newStatus = btn.dataset.status;
      const { error } = await sb.from('tasks').update({ status: newStatus }).eq('id', task.id);
      if (error) alert('Erreur : ' + error.message);
      else openTaskDetail(task.id);  // re-render
    });
  });
  document.getElementById('detailEdit')?.addEventListener('click', () => {
    closeTaskDetail();
    openTaskModal(task);
  });
  document.getElementById('detailDelete')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cette tâche ?')) return;
    const { error } = await sb.from('tasks').delete().eq('id', task.id);
    if (error) alert('Erreur : ' + error.message);
    else closeTaskDetail();
  });

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
  f.cover_file.value  = '';

  // Dossier lié
  f.folder_id.innerHTML = '<option value="">— Aucun —</option>' +
    state.folders.map(fo => `<option value="${fo.id}" ${task?.folder_id===fo.id?'selected':''}>${escapeHtml(folderBreadcrumb(fo.id))}</option>`).join('');

  // Liste de checkboxes pour multi-assignés
  const currentAssignees = task ? (state.assigneesByTask[task.id] || []) : [];
  document.getElementById('assigneeList').innerHTML = state.profiles.map(p => `
    <label class="cb-item">
      <input type="checkbox" name="assignees" value="${p.id}" ${currentAssignees.includes(p.id) ? 'checked' : ''}>
      <span>${escapeHtml(p.full_name)}</span>
    </label>`).join('');

  // Hint cover
  const hint = document.getElementById('coverHint');
  if (!state.serverUrl) {
    hint.textContent = '⚠️ Serveur PC non configuré — l\'image de couverture sera ignorée.';
    hint.className = 'form-hint form-hint-warn';
  } else if (task?.cover_file_id) {
    hint.textContent = 'Une image est déjà définie. Sélectionne un nouveau fichier pour la remplacer.';
    hint.className = 'form-hint';
  } else {
    hint.textContent = '';
  }

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
    folder_id:   f.folder_id.value || null
  };
  if (!payload.title) { alert('Titre requis'); return; }

  // Récupérer les assignés cochés
  const selectedAssignees = [...f.querySelectorAll('input[name="assignees"]:checked')].map(c => c.value);

  // 1) Upload de la cover si fournie et serveur disponible
  const coverFile = f.cover_file.files[0];
  if (coverFile && state.serverUrl) {
    try {
      const token = (await sb.auth.getSession()).data.session.access_token;
      const fd = new FormData();
      fd.append('file', coverFile);
      const r = await fetch(`${state.serverUrl}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      if (r.ok) {
        const { file } = await r.json();
        payload.cover_file_id = file.id;
      } else {
        console.warn('Cover upload failed, task will be created without cover');
      }
    } catch (err) {
      console.warn('Cover upload error:', err);
    }
  }

  // 2) Insert ou update de la tâche
  let taskId = f.dataset.id;
  let error;
  if (taskId) {
    ({ error } = await sb.from('tasks').update(payload).eq('id', taskId));
  } else {
    payload.created_by = state.me.id;
    const { data, error: insErr } = await sb.from('tasks').insert(payload).select().single();
    error = insErr;
    if (data) taskId = data.id;
  }
  if (error) { alert('Erreur: ' + error.message); return; }

  // 3) Synchroniser les assignés (delete all + insert all)
  if (taskId) {
    await sb.from('task_assignees').delete().eq('task_id', taskId);
    if (selectedAssignees.length > 0) {
      const rows = selectedAssignees.map(uid => ({ task_id: taskId, user_id: uid }));
      const { error: aErr } = await sb.from('task_assignees').insert(rows);
      if (aErr) console.error('Assignees error:', aErr);
    }
  }

  closeTaskModal();
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
})();
