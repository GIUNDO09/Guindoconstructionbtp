// =========================================================
// GCBTP — Page détail Projet (onglets Tâches/Fichiers/Équipe/Infos)
// =========================================================
(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

const state = {
  me: null,
  projectId: null,
  project: null,
  tasks: [],
  assigneesByTask: {},
  members: [],         // [user_id, ...]
  files: [],
  profilesById: {},
  allProjects: [],     // [{id, name, status}, ...] pour dropdown "déplacer"
  serverUrl: null,
  conversationId: null,
  currentTab: 'tasks',
  editingTaskId: null
};

(async () => {
  const session = await requireAuth();
  if (!session) return;
  state.me = await currentProfile();
  document.getElementById('userName').textContent = state.me?.full_name || session.user.email;

  const params = new URLSearchParams(location.search);
  state.projectId = params.get('id');
  if (!state.projectId) {
    document.getElementById('projectLoading').textContent = '❌ ID projet manquant.';
    return;
  }

  bindUI();
  await Promise.all([loadProfiles(), loadServerUrl(), loadProject(), loadAllProjects(), loadTasks(), loadAssignees(), loadMembers(), loadFiles(), loadConversation()]);

  if (!state.project) {
    document.getElementById('projectLoading').textContent = '❌ Projet introuvable ou accès refusé.';
    return;
  }

  document.getElementById('projectLoading').hidden = true;
  document.getElementById('projectContent').hidden = false;

  if (state.me?.role === 'admin') {
    document.getElementById('projEditBtn').hidden = false;
    document.getElementById('projDeleteBtn').hidden = false;
    document.getElementById('newProjectTaskBtn').hidden = false;
    document.getElementById('quickUploadBtn').hidden = false;
  }

  renderAll();

  // Realtime
  sb.channel(`project-${state.projectId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${state.projectId}` }, async () => {
      await loadProject(); renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${state.projectId}` }, async () => {
      await Promise.all([loadTasks(), loadAssignees()]); renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, async () => {
      await loadAssignees(); renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${state.projectId}` }, async () => {
      await loadMembers(); renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, async () => {
      await loadFiles(); renderAll();
    })
    .subscribe();
})();

// ----------------------------------------------------------
// Loaders
// ----------------------------------------------------------
async function loadProfiles() {
  const data = await window.gcbtp.cache.getProfiles();
  state.profilesById = Object.fromEntries((data || []).map(p => [p.id, p]));
}
async function loadServerUrl() {
  state.serverUrl = await window.gcbtp.cache.getServerUrl();
}
async function loadProject() {
  const { data } = await sb.from('projects').select('*').eq('id', state.projectId).maybeSingle();
  state.project = data;
}
async function loadAllProjects() {
  const { data } = await sb.from('projects').select('id, name, status').order('name');
  state.allProjects = data || [];
}
async function loadTasks() {
  const { data } = await sb.from('tasks').select('*').eq('project_id', state.projectId);
  state.tasks = data || [];
}
async function loadAssignees() {
  const ids = state.tasks.map(t => t.id);
  if (!ids.length) { state.assigneesByTask = {}; return; }
  const { data } = await sb.from('task_assignees').select('*').in('task_id', ids);
  state.assigneesByTask = {};
  (data || []).forEach(a => {
    (state.assigneesByTask[a.task_id] ||= []).push(a.user_id);
  });
}
async function loadMembers() {
  const { data } = await sb.from('project_members').select('user_id, role').eq('project_id', state.projectId);
  state.members = (data || []);
}
async function loadFiles() {
  if (!state.project?.folder_id) { state.files = []; return; }
  const { data } = await sb.from('files').select('*').eq('folder_id', state.project.folder_id).order('created_at', { ascending: false }).limit(20);
  state.files = data || [];
}
async function loadConversation() {
  const { data } = await sb.from('conversations').select('id').eq('project_id', state.projectId).maybeSingle();
  state.conversationId = data?.id || null;
}

// ----------------------------------------------------------
// UI bindings
// ----------------------------------------------------------
function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  document.querySelectorAll('.project-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('newProjectTaskBtn').addEventListener('click', () => openTaskModal());
  document.getElementById('modalCancel').addEventListener('click', closeTaskModal);
  document.getElementById('taskForm').addEventListener('submit', onTaskSubmit);
  document.getElementById('taskModal').addEventListener('click', (e) => {
    if (e.target.id === 'taskModal') closeTaskModal();
  });

  document.getElementById('projEditBtn').addEventListener('click', openProjEditModal);
  document.getElementById('projEditClose').addEventListener('click', closeProjEditModal);
  document.getElementById('projEditCancel').addEventListener('click', closeProjEditModal);
  document.getElementById('projEditForm').addEventListener('submit', onProjEditSubmit);
  document.getElementById('projEditModal').addEventListener('click', (e) => {
    if (e.target.id === 'projEditModal') closeProjEditModal();
  });

  // Suppression du projet (admin)
  document.getElementById('projDeleteBtn').addEventListener('click', openDeleteProjectModal);
  document.getElementById('projDeleteClose').addEventListener('click', closeDeleteProjectModal);
  document.getElementById('projDeleteCancel').addEventListener('click', closeDeleteProjectModal);
  document.getElementById('projDeleteConfirm').addEventListener('click', performDeleteProject);
  document.getElementById('projDeleteModal').addEventListener('click', (e) => {
    if (e.target.id === 'projDeleteModal') closeDeleteProjectModal();
  });
  document.getElementById('delTasks').addEventListener('change', updateDeleteConfirmState);
  document.getElementById('delFiles').addEventListener('change', updateDeleteConfirmState);
  document.getElementById('delConfirmInput').addEventListener('input', updateDeleteConfirmState);

  document.getElementById('projChatBtn').addEventListener('click', () => {
    if (state.conversationId) location.href = `chat.html?conv=${state.conversationId}`;
    else alert('Conversation projet non trouvée.');
  });

  // Upload rapide dans le dossier du projet
  document.getElementById('quickUploadBtn').addEventListener('click', () => {
    document.getElementById('quickUploadInput').click();
  });
  document.getElementById('quickUploadInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    await uploadProjectFiles(files);
  });

  // Click sur une tâche → modal détail (TODO: implement) OU edit pour admin
  document.getElementById('projectTaskList').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.proj-task-edit');
    if (editBtn) {
      const t = state.tasks.find(x => x.id === editBtn.dataset.taskId);
      if (t) openTaskModal(t);
      return;
    }
    const delBtn = e.target.closest('.proj-task-delete');
    if (delBtn) {
      handleTaskDelete(delBtn.dataset.taskId);
      return;
    }
  });
}

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.project-tab').forEach(b => {
    b.classList.toggle('project-tab-active', b.dataset.tab === tab);
  });
  ['tasks', 'files', 'team', 'info'].forEach(id => {
    const el = document.getElementById('tab' + id[0].toUpperCase() + id.slice(1));
    if (el) el.hidden = id !== tab;
  });
  window.gcbtp?.renderIcons?.();
}

// ----------------------------------------------------------
// Render
// ----------------------------------------------------------
function renderAll() {
  if (!state.project) return;
  renderHero();
  renderTasksTab();
  renderFilesTab();
  renderTeamTab();
  renderInfoTab();
  window.gcbtp?.renderIcons?.();
}

function renderHero() {
  const p = state.project;
  document.getElementById('projectName').textContent = p.name;

  const status = document.getElementById('projectStatus');
  status.textContent = STATUS_LABEL[p.status] || p.status;
  status.className = 'proj-card-status proj-status-' + p.status;

  setMeta('projectClient',   p.client);
  setMeta('projectLocation', p.location);
  setMeta('projectDates',    formatDateRange(p.start_date, p.end_date));

  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.status === 'done').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('projGaugeFill').style.width = pct + '%';
  document.getElementById('projProgressText').textContent = `${done}/${total} · ${pct}%`;
  document.getElementById('tabTasksCount').textContent = total;
  document.getElementById('tabTeamCount').textContent = state.members.length;
}

function setMeta(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!value) { el.hidden = true; return; }
  el.hidden = false;
  el.querySelector('span').textContent = value;
}

const STATUS_LABEL = { active: 'Actif', done: 'Terminé', on_hold: 'En pause', cancelled: 'Annulé' };

// ---- Onglet TÂCHES (Gantt + liste) ----
function renderTasksTab() {
  renderProjectGantt();
  renderProjectTaskList();
}

function renderProjectGantt() {
  const box = document.getElementById('projectGantt');
  if (!state.tasks.length) { box.innerHTML = ''; return; }
  const today = todayIso();
  const allDates = [];
  state.tasks.forEach(t => {
    const start = (t.created_at || '').slice(0, 10);
    const end = t.due_date || (t.status === 'done' ? (t.updated_at || '').slice(0, 10) : today);
    if (start) allDates.push(start);
    if (end) allDates.push(end);
  });
  if (!allDates.length) { box.innerHTML = ''; return; }
  const minDate = allDates.reduce((a, b) => a < b ? a : b);
  let maxDate = allDates.reduce((a, b) => a > b ? a : b);
  if (maxDate < today) maxDate = today;
  const range = Math.max(daysBetween(minDate, maxDate), 1);
  const padded = addDays(maxDate, Math.max(2, Math.round(range * 0.05)));
  const todayPct = pctOf(today, minDate, padded);

  const sorted = state.tasks.slice().sort((a, b) => {
    if (!a.due_date && !b.due_date) return new Date(a.created_at) - new Date(b.created_at);
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
  const months = monthsBetween(minDate, padded);

  box.innerHTML = `
    <div class="gantt">
      <div class="gantt-axis">
        ${months.map(m => `<span class="gantt-month" style="left:${pctOf(m.iso, minDate, padded)}%">${m.label}</span>`).join('')}
        <div class="gantt-today" style="left:${todayPct}%"><span class="gantt-today-label">Aujourd'hui</span></div>
      </div>
      <ul class="gantt-rows">
        ${sorted.map(t => renderGanttRow(t, minDate, padded, today)).join('')}
      </ul>
    </div>`;
}

function renderGanttRow(task, minDate, maxDate, today) {
  const start = (task.created_at || '').slice(0, 10);
  const due = task.due_date;
  const isOverdue = task.status !== 'done' && due && due < today;
  const status = task.status === 'done' ? 'done' : isOverdue ? 'overdue' : task.status === 'in_progress' ? 'progress' : 'todo';
  let segEnd;
  if (task.status === 'done') segEnd = (task.updated_at || '').slice(0, 10) || due || today;
  else if (due) segEnd = due;
  else segEnd = addDays(today, 7);
  const left = Math.max(0, pctOf(start || today, minDate, maxDate));
  const right = pctOf(segEnd, minDate, maxDate);
  const width = Math.max(1.5, right - left);
  const dueLabel = due ? new Date(due).toLocaleDateString('fr-FR') : 'Sans échéance';
  return `
    <li class="gantt-row gantt-row-${status}">
      <div class="gantt-label">${escapeHtml(task.title)}</div>
      <div class="gantt-track">
        <div class="gantt-bar gantt-bar-${status}" style="left:${left}%; width:${width}%">
          <span class="gantt-bar-text">${dueLabel}</span>
        </div>
      </div>
    </li>`;
}

function renderProjectTaskList() {
  const box = document.getElementById('projectTaskList');
  const today = todayIso();
  const isAdmin = state.me?.role === 'admin';
  if (!state.tasks.length) {
    box.innerHTML = '<p class="empty">Aucune tâche pour ce projet. ' + (isAdmin ? 'Clique "Nouvelle tâche" pour commencer.' : '') + '</p>';
    return;
  }
  const sorted = state.tasks.slice().sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  box.innerHTML = `
    <ul class="proj-task-list">
      ${sorted.map(t => {
        const isOverdue = t.status !== 'done' && t.due_date && t.due_date < today;
        const status = t.status === 'done' ? 'done' : isOverdue ? 'overdue' : t.status;
        const dueLabel = t.due_date ? new Date(t.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—';
        const assignees = (state.assigneesByTask[t.id] || []).map(uid => {
          const profile = state.profilesById[uid];
          if (!profile) return '';
          return `<span class="proj-member-avatar" title="${escapeAttr(profile.full_name)}">${escapeHtml(initialsOf(profile.full_name))}</span>`;
        }).join('');
        const adminBtns = isAdmin ? `
          <button type="button" class="msg-act proj-task-edit" data-task-id="${t.id}" title="Modifier"><i data-lucide="pen"></i></button>
          <button type="button" class="msg-act proj-task-delete" data-task-id="${t.id}" title="Supprimer"><i data-lucide="trash-2"></i></button>` : '';
        return `
          <li class="proj-task" data-task-id="${t.id}">
            <span class="proj-task-status proj-task-status-${status}">${STATUS_TASK_LABEL[status]}</span>
            <span class="proj-task-title">${escapeHtml(t.title)}</span>
            <div class="proj-member-stack proj-task-assignees">${assignees}</div>
            <span class="proj-task-due ${isOverdue ? 'mt-task-due-overdue' : ''}">${escapeHtml(dueLabel)}</span>
            <div class="proj-task-actions">${adminBtns}</div>
          </li>`;
      }).join('')}
    </ul>`;
}
const STATUS_TASK_LABEL = { todo: 'À faire', in_progress: 'En cours', done: 'Terminée', overdue: 'En retard' };

// ---- Onglet FICHIERS ----
function renderFilesTab() {
  const folderName = state.project?.name || 'Projet';
  document.getElementById('folderName').textContent = folderName;
  const link = document.getElementById('openFolderLink');
  if (link && state.project?.folder_id) {
    link.href = `files.html#folder-${state.project.folder_id}`;
  }
  const box = document.getElementById('projectFiles');
  if (!state.files.length) {
    box.innerHTML = '<p class="empty">Aucun fichier dans ce projet pour le moment.</p>';
    return;
  }
  box.innerHTML = state.files.map(f => {
    const mime = f.mime_type || '';
    const isImage = mime.startsWith('image/');
    const dateStr = new Date(f.created_at).toLocaleDateString('fr-FR');
    const sizeStr = formatBytes(f.size_bytes);
    if (isImage) {
      return `
        <div class="proj-file-card proj-file-image" data-file-id="${f.id}" title="${escapeAttr(f.name)}">
          <img data-thumb-id="${f.id}" alt="${escapeAttr(f.name)}">
          <div class="proj-file-info">
            <span class="proj-file-name">${escapeHtml(f.name)}</span>
            <span class="proj-file-meta">${sizeStr} · ${dateStr}</span>
          </div>
        </div>`;
    }
    const icon = mime.includes('pdf') ? 'file-text' : mime.startsWith('video/') ? 'film' : 'file';
    return `
      <div class="proj-file-card" data-file-id="${f.id}">
        <i data-lucide="${icon}" class="proj-file-icon"></i>
        <div class="proj-file-info">
          <span class="proj-file-name">${escapeHtml(f.name)}</span>
          <span class="proj-file-meta">${sizeStr} · ${dateStr}</span>
        </div>
      </div>`;
  }).join('');
  // Hydrate thumbnails authentifiés
  box.querySelectorAll('img[data-thumb-id]').forEach(img => loadAuthedImage(img, img.dataset.thumbId));
}

async function loadAuthedImage(imgEl, fileId) {
  if (!state.serverUrl || !fileId) return;
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) return;
    const r = await fetch(`${state.serverUrl}/stream/${fileId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return;
    const blob = await r.blob();
    imgEl.src = URL.createObjectURL(blob);
  } catch {}
}

async function uploadProjectFiles(files) {
  if (!state.serverUrl) { alert('Serveur PC non configuré'); return; }
  if (!state.project?.folder_id) { alert('Dossier projet non trouvé'); return; }
  const token = (await sb.auth.getSession()).data.session?.access_token;
  if (!token) { alert('Session expirée'); return; }
  const progress = document.getElementById('quickUploadProgress');
  progress.hidden = false;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    progress.textContent = `Upload ${i + 1}/${files.length} : ${f.name}`;
    const fd = new FormData();
    fd.append('file', f);
    fd.append('folder_id', state.project.folder_id);
    try {
      const r = await fetch(`${state.serverUrl}/upload`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) { alert('Erreur sur ' + f.name + ' : ' + e.message); }
  }
  progress.textContent = '✅ Upload terminé';
  setTimeout(() => { progress.hidden = true; }, 2500);
  await loadFiles();
  renderAll();
}

// ---- Onglet ÉQUIPE ----
function renderTeamTab() {
  const box = document.getElementById('projectTeam');
  if (!state.members.length) {
    box.innerHTML = '<p class="empty">Aucun membre encore. Ils s\'ajoutent automatiquement quand tu leur assignes une tâche.</p>';
    return;
  }
  box.innerHTML = state.members.map(m => {
    const profile = state.profilesById[m.user_id];
    if (!profile) return '';
    const myTasks = state.tasks.filter(t => (state.assigneesByTask[t.id] || []).includes(m.user_id));
    const done = myTasks.filter(t => t.status === 'done').length;
    return `
      <a href="profil-public.html?id=${m.user_id}" class="proj-team-card">
        <div class="member-avatar">${escapeHtml(initialsOf(profile.full_name))}</div>
        <div class="proj-team-info">
          <div class="proj-team-name">${escapeHtml(profile.full_name || '?')}</div>
          <div class="proj-team-sub">${m.role === 'owner' ? '👑 Propriétaire · ' : ''}${done}/${myTasks.length} tâches</div>
        </div>
      </a>`;
  }).join('');
}

// ---- Onglet INFOS ----
function renderInfoTab() {
  const p = state.project;
  document.getElementById('infoDescription').textContent = p.description || '—';
  document.getElementById('infoClient').textContent     = p.client || '—';
  document.getElementById('infoLocation').textContent   = p.location || '—';
  document.getElementById('infoDates').textContent      = formatDateRange(p.start_date, p.end_date) || '—';
  document.getElementById('infoStatus').textContent     = STATUS_LABEL[p.status] || p.status;
  const creator = state.profilesById[p.created_by];
  document.getElementById('infoCreator').textContent    = creator?.full_name || '—';
}

// ----------------------------------------------------------
// Modal "Nouvelle tâche" (pré-remplie avec ce projet)
// ----------------------------------------------------------
function openTaskModal(task = null) {
  state.editingTaskId = task?.id || null;
  const modal = document.getElementById('taskModal');
  const form = document.getElementById('taskForm');
  document.getElementById('modalTitle').textContent = task ? 'Modifier la tâche' : 'Nouvelle tâche du projet';
  form.reset();
  if (task) {
    form.title.value = task.title || '';
    form.description.value = task.description || '';
    form.due_date.value = task.due_date || '';
    form.priority.value = task.priority || 'medium';
    form.status.value = task.status || 'todo';
  }

  // Dropdown "Chantier / Projet" : tous les projets, par défaut celui ouvert
  const projSel = form.project_id;
  const currentProjId = task?.project_id || state.projectId;
  projSel.innerHTML = '<option value="">— Aucun —</option>' +
    state.allProjects.map(p => `<option value="${p.id}" ${currentProjId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}${p.status !== 'active' ? ' · ' + p.status : ''}</option>`).join('');

  // Liste des assignés possibles : tous les profils
  const assigneeBox = document.getElementById('assigneeList');
  const allProfiles = Object.values(state.profilesById)
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  const currentAssignees = task ? (state.assigneesByTask[task.id] || []) : [];
  assigneeBox.innerHTML = allProfiles.map(p => `
    <label class="checkbox-row">
      <input type="checkbox" name="assignee" value="${p.id}" ${currentAssignees.includes(p.id) ? 'checked' : ''}>
      <span>${escapeHtml(p.full_name || 'Sans nom')}</span>
    </label>`).join('');

  modal.hidden = false;
  window.gcbtp?.renderIcons?.();
}

function closeTaskModal() {
  document.getElementById('taskModal').hidden = true;
  state.editingTaskId = null;
}

async function onTaskSubmit(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const submit = f.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    const selectedAssignees = [...f.querySelectorAll('input[name="assignee"]:checked')].map(c => c.value);
    const targetProjectId = f.project_id.value || null;
    const targetProject = targetProjectId
      ? state.allProjects.find(p => p.id === targetProjectId)
      : null;
    const payload = {
      title: f.title.value.trim(),
      description: f.description.value.trim() || null,
      due_date: f.due_date.value || null,
      priority: f.priority.value,
      status: f.status.value,
      project_id: targetProjectId,                     // permet le déplacement
      project: targetProject?.name || null             // denormalised legacy
    };
    if (!payload.title) throw new Error('Titre requis');

    let taskId = state.editingTaskId;
    if (taskId) {
      const { error } = await sb.from('tasks').update(payload).eq('id', taskId);
      if (error) throw error;
      // Synchro assignations : DELETE all puis INSERT
      await sb.from('task_assignees').delete().eq('task_id', taskId);
    } else {
      const { data, error } = await sb.from('tasks').insert(payload).select().single();
      if (error) throw error;
      taskId = data.id;
    }
    if (selectedAssignees.length) {
      await sb.from('task_assignees').insert(
        selectedAssignees.map(uid => ({ task_id: taskId, user_id: uid }))
      );
    }
    closeTaskModal();
  } catch (e) {
    alert('Erreur : ' + e.message);
  } finally {
    submit.disabled = false;
  }
}

async function handleTaskDelete(taskId) {
  if (!confirm('Supprimer cette tâche ? Les preuves liées seront aussi supprimées.')) return;
  const { error } = await sb.from('tasks').delete().eq('id', taskId);
  if (error) alert('Erreur : ' + error.message);
}

// ----------------------------------------------------------
// Modal "Modifier le projet" (admin)
// ----------------------------------------------------------
function openProjEditModal() {
  const p = state.project;
  const f = document.getElementById('projEditForm');
  f.name.value = p.name || '';
  f.description.value = p.description || '';
  f.client.value = p.client || '';
  f.location.value = p.location || '';
  f.start_date.value = p.start_date || '';
  f.end_date.value = p.end_date || '';
  f.status.value = p.status || 'active';
  document.getElementById('projEditModal').hidden = false;
}
function closeProjEditModal() {
  document.getElementById('projEditModal').hidden = true;
}
async function onProjEditSubmit(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const submit = f.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    const { error } = await sb.from('projects').update({
      name: f.name.value.trim(),
      description: f.description.value.trim() || null,
      client: f.client.value.trim() || null,
      location: f.location.value.trim() || null,
      start_date: f.start_date.value || null,
      end_date: f.end_date.value || null,
      status: f.status.value
    }).eq('id', state.projectId);
    if (error) throw error;
    closeProjEditModal();
  } catch (e) {
    alert('Erreur : ' + e.message);
  } finally {
    submit.disabled = false;
  }
}

// ----------------------------------------------------------
// Suppression d'un projet (admin)
// ----------------------------------------------------------
function openDeleteProjectModal() {
  document.getElementById('delProjName').textContent = state.project.name;
  document.getElementById('delTasksCount').textContent = state.tasks.length;
  document.getElementById('delFilesCount').textContent = state.files.length;
  document.getElementById('delTasks').checked = true;
  document.getElementById('delFiles').checked = false;
  document.getElementById('delConfirmInput').value = '';
  document.getElementById('delConfirmName').hidden = true;
  document.getElementById('projDeleteConfirm').disabled = false;
  document.getElementById('projDeleteModal').hidden = false;
  window.gcbtp?.renderIcons?.();
}

function closeDeleteProjectModal() {
  document.getElementById('projDeleteModal').hidden = true;
}

function updateDeleteConfirmState() {
  const delFiles = document.getElementById('delFiles').checked;
  const fileCount = state.files.length;
  // Garde-fou : retape du nom obligatoire si on supprime des fichiers
  // (effet irréversible sur disque)
  const dangerous = delFiles && fileCount > 0;
  const confirmBox = document.getElementById('delConfirmName');
  const confirmInput = document.getElementById('delConfirmInput');
  const confirmBtn = document.getElementById('projDeleteConfirm');

  confirmBox.hidden = !dangerous;
  if (dangerous) {
    const typed = confirmInput.value.trim();
    confirmBtn.disabled = (typed !== state.project.name);
  } else {
    confirmBtn.disabled = false;
  }
}

async function performDeleteProject() {
  const delTasks = document.getElementById('delTasks').checked;
  const delFiles = document.getElementById('delFiles').checked;
  const btn = document.getElementById('projDeleteConfirm');
  btn.disabled = true;
  btn.textContent = 'Suppression…';
  try {
    // 1) Tâches (si demandé) — sinon laisse project_id à NULL via FK SET NULL
    if (delTasks && state.tasks.length > 0) {
      const { error } = await sb.from('tasks').delete().eq('project_id', state.projectId);
      if (error) throw new Error('Suppression tâches : ' + error.message);
    }

    // 2) Dossier projet (si demandé) — passe par pc-server pour nettoyer le disque
    if (delFiles && state.project?.folder_id) {
      if (!state.serverUrl) throw new Error('Serveur PC non configuré — impossible de supprimer le dossier');
      const token = (await sb.auth.getSession()).data.session?.access_token;
      const r = await fetch(`${state.serverUrl}/folder/${state.project.folder_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!r.ok) throw new Error('Suppression dossier : ' + (await r.text()));
    }

    // 3) Le projet (cascade : conversations, project_members, conversation_participants)
    const { error } = await sb.from('projects').delete().eq('id', state.projectId);
    if (error) throw error;

    // OK → retour à la liste
    location.href = 'projects.html';
  } catch (e) {
    alert('Erreur : ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="trash-2"></i> Supprimer définitivement';
    window.gcbtp?.renderIcons?.();
  }
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------
function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function pctOf(iso, minIso, maxIso) {
  const total = new Date(maxIso) - new Date(minIso);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, ((new Date(iso) - new Date(minIso)) / total) * 100));
}
function monthsBetween(minIso, maxIso) {
  const out = [];
  const start = new Date(minIso); start.setDate(1);
  const end = new Date(maxIso);
  while (start <= end) {
    out.push({ iso: start.toISOString().slice(0, 10), label: start.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) });
    start.setMonth(start.getMonth() + 1);
  }
  return out;
}
function formatDateRange(s, e) {
  const fmt = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  if (s && e) return `${fmt(s)} → ${fmt(e)}`;
  if (s) return `Démarré ${fmt(s)}`;
  if (e) return `Échéance ${fmt(e)}`;
  return '';
}
function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
}
function initialsOf(s) {
  const parts = String(s || '').trim().split(/\s+/);
  if (!parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
})();
