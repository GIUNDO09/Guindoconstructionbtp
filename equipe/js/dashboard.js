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
  // Vue par membre : null = grille, sinon user_id du membre affiché
  viewMember: null,
  // Conservés pour la compat (ne sont plus exposés en UI dans cette vague)
  filters: { assignee: 'all', status: 'all', search: '', sort: 'due' },
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
  const isAdmin = state.me?.role === 'admin';
  if (isAdmin) {
    const ntb = document.getElementById('newTaskBtn');
    if (ntb) ntb.hidden = false;
    const mntb = document.getElementById('memberNewTaskBtn');
    if (mntb) mntb.hidden = false;
  }

  await Promise.all([loadProfiles(), loadTasks(), loadAssignees(), loadFolders(), loadServerUrl()]);

  // Si non-admin → on entre direct sur sa propre vue (pas la grille)
  if (!isAdmin && state.me?.id) state.viewMember = state.me.id;
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
  state.serverUrl = await window.gcbtp.cache.getServerUrl();
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
  const data = await window.gcbtp.cache.getProfiles();
  state.profiles = (data || []).slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
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
  renderMiniStats();
  if (state.viewMember) {
    showOnly('memberView');
    renderMemberView(state.viewMember);
  } else {
    showOnly('membersGridView');
    renderMembersGrid();
  }
  window.gcbtp?.renderIcons?.();
}

function showOnly(id) {
  const grid = document.getElementById('membersGridView');
  const member = document.getElementById('memberView');
  if (grid)   grid.hidden   = (id !== 'membersGridView');
  if (member) member.hidden = (id !== 'memberView');
  // Mini-stats visibles seulement en vue grille (sinon redondant)
  const mini = document.getElementById('miniStats');
  if (mini) mini.hidden = (id !== 'membersGridView') || !state.profiles.length;
}

// ----------------------------------------------------------
// Mini-stats inline (1 ligne)
// ----------------------------------------------------------
function renderMiniStats() {
  const today = todayIso();
  const inProgress = state.tasks.filter(t => t.status === 'in_progress').length;
  const overdue    = state.tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < today).length;
  // Terminées cette semaine = updated_at dans les 7 derniers jours et status=done
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoIso = weekAgo.toISOString();
  const doneWeek = state.tasks.filter(t => t.status === 'done' && t.updated_at && t.updated_at >= weekAgoIso).length;

  const ip = document.getElementById('miStInProgress');
  const od = document.getElementById('miStOverdue');
  const dw = document.getElementById('miStDoneWeek');
  if (ip) ip.textContent = inProgress;
  if (od) od.textContent = overdue;
  if (dw) dw.textContent = doneWeek;
}

// ----------------------------------------------------------
// Grille des membres (vue admin par défaut)
// ----------------------------------------------------------
function renderMembersGrid() {
  const box = document.getElementById('membersGrid');
  if (!box) return;
  const today = todayIso();
  const cards = state.profiles
    .slice()
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    .map(p => {
      const taskIds = Object.entries(state.assigneesByTask)
        .filter(([_, uids]) => uids.includes(p.id))
        .map(([tid]) => tid);
      const tasks = taskIds.map(id => state.tasks.find(t => t.id === id)).filter(Boolean);
      const total = tasks.length;
      const done = tasks.filter(t => t.status === 'done').length;
      const active = tasks.filter(t => t.status !== 'done').length;
      const overdue = tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < today).length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      return `
        <button type="button" class="member-card" data-user-id="${p.id}">
          <div class="member-avatar" data-avatar-user="${p.id}">${escapeHtml(initials(p.full_name))}</div>
          <div class="member-card-body">
            <div class="member-name">${escapeHtml(p.full_name || 'Sans nom')}</div>
            <div class="member-card-sub">${escapeHtml(p.title || (p.role === 'admin' ? 'Admin' : 'Membre'))}</div>
            <div class="member-card-stats">
              <span class="chip">${active} active${active > 1 ? 's' : ''}</span>
              ${overdue ? `<span class="chip chip-danger"><i data-lucide="alert-triangle"></i> ${overdue}</span>` : ''}
            </div>
          </div>
          <div class="member-card-progress" style="--p:${pct}" title="${done} sur ${total} terminées">
            <span class="member-card-pct">${pct}%</span>
          </div>
        </button>`;
    }).join('');
  box.innerHTML = cards || '<p class="empty">Aucun membre dans l\'équipe.</p>';
  // Hydrate avatars
  box.querySelectorAll('[data-avatar-user]').forEach(el => {
    const profile = state.profilesById[el.dataset.avatarUser];
    if (profile?.avatar_file_id && state.serverUrl) {
      hydrateAvatar(el, profile.avatar_file_id);
    }
  });
}

async function hydrateAvatar(el, fileId) {
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) return;
    const r = await fetch(`${state.serverUrl}/stream/${fileId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.alt = '';
    el.textContent = '';
    el.appendChild(img);
  } catch {}
}

// ----------------------------------------------------------
// Vue d'un membre : tâches groupées par projet, avec cases
// ----------------------------------------------------------
function renderMemberView(userId) {
  const member = state.profilesById[userId];
  if (!member) {
    document.getElementById('memberProjects').innerHTML = '<p class="empty">Membre introuvable.</p>';
    return;
  }
  // Header membre
  document.getElementById('memberViewName').textContent = member.full_name || 'Sans nom';
  document.getElementById('memberViewSub').textContent = member.title || (member.role === 'admin' ? '👑 Admin' : '👤 Membre');
  // Avatar
  const avBox = document.getElementById('memberViewAvatar');
  avBox.innerHTML = '';
  avBox.dataset.avatarUser = member.id;
  avBox.textContent = initials(member.full_name);
  if (member.avatar_file_id && state.serverUrl) hydrateAvatar(avBox, member.avatar_file_id);

  // Bouton "back" : visible uniquement pour admin (les membres restent sur leur vue)
  const backBtn = document.getElementById('memberBackBtn');
  if (backBtn) backBtn.hidden = state.me?.role !== 'admin';

  // Tâches du membre, groupées par projet
  const myTaskIds = Object.entries(state.assigneesByTask)
    .filter(([_, uids]) => uids.includes(userId))
    .map(([tid]) => tid);
  const myTasks = myTaskIds.map(id => state.tasks.find(t => t.id === id)).filter(Boolean);

  const groups = {};
  myTasks.forEach(t => {
    const key = (t.project || '').trim() || '(Sans chantier)';
    (groups[key] ||= []).push(t);
  });

  const today = todayIso();
  const sortedGroups = Object.entries(groups).map(([project, ts]) => ({
    project,
    tasks: ts.slice().sort((a, b) => {
      // À faire / en cours d'abord (par échéance), terminées en bas
      const aDone = a.status === 'done', bDone = b.status === 'done';
      if (aDone !== bDone) return aDone ? 1 : -1;
      return (a.due_date || '9999').localeCompare(b.due_date || '9999');
    }),
    stats: ((arr) => {
      const total = arr.length;
      const done = arr.filter(t => t.status === 'done').length;
      const overdue = arr.filter(t => t.status !== 'done' && t.due_date && t.due_date < today).length;
      return { total, done, overdue, pct: total ? Math.round(done / total * 100) : 0 };
    })(ts)
  })).sort((a, b) => {
    if (b.stats.overdue !== a.stats.overdue) return b.stats.overdue - a.stats.overdue;
    return a.project.localeCompare(b.project);
  });

  const box = document.getElementById('memberProjects');
  if (!sortedGroups.length) {
    box.innerHTML = '<p class="empty">Aucune tâche assignée à ce membre.</p>';
    return;
  }
  box.innerHTML = sortedGroups.map(g => renderMemberProject(g, userId, today)).join('');
  window.gcbtp?.renderIcons?.();
}

function renderMemberProject(g, userId, today) {
  const { project, tasks, stats } = g;
  const isMe = userId === state.me?.id;
  const isAdmin = state.me?.role === 'admin';
  const canToggle = isMe || isAdmin;
  return `
    <section class="mt-project" data-project="${escapeAttr(project)}">
      <header class="mt-project-head">
        <div class="mt-project-title">
          <i data-lucide="hard-hat"></i>
          <h3>${escapeHtml(project)}</h3>
          <span class="mt-project-count">${stats.done}/${stats.total} · ${stats.pct}%</span>
        </div>
        <div class="proj-gauge"><div class="proj-gauge-fill" style="width:${stats.pct}%"></div></div>
      </header>
      <ul class="mt-tasks">
        ${tasks.map(t => renderMemberTaskRow(t, today, canToggle)).join('')}
      </ul>
    </section>`;
}

function renderMemberTaskRow(t, today, canToggle) {
  const checked = t.status === 'done';
  const isOverdue = !checked && t.due_date && t.due_date < today;
  const dueLabel = t.due_date
    ? new Date(t.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
    : '—';
  return `
    <li class="mt-task ${checked ? 'mt-task-done' : ''} ${isOverdue ? 'mt-task-overdue' : ''}">
      <label class="mt-check-wrap">
        <input type="checkbox" class="mt-check" data-task-id="${t.id}" ${checked ? 'checked' : ''} ${canToggle ? '' : 'disabled'}>
        <span class="mt-check-box"><i data-lucide="check"></i></span>
      </label>
      <button type="button" class="mt-task-title" data-open-id="${t.id}">${escapeHtml(t.title)}</button>
      <span class="mt-task-due ${isOverdue ? 'mt-task-due-overdue' : ''}">${escapeHtml(dueLabel)}</span>
    </li>`;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

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
  const { assignee, status, search, sort } = state.filters;
  let tasks = state.tasks.slice();
  if (assignee === 'me')        tasks = tasks.filter(t => (state.assigneesByTask[t.id] || []).includes(state.me.id));
  else if (assignee !== 'all')  tasks = tasks.filter(t => (state.assigneesByTask[t.id] || []).includes(assignee));
  if (status !== 'all')          tasks = tasks.filter(t => t.status === status);

  if (search) {
    const q = search.toLowerCase();
    tasks = tasks.filter(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.project || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
    );
  }

  // Tri
  const PR_RANK = { high: 0, medium: 1, low: 2 };
  if (sort === 'priority') {
    tasks.sort((a, b) => (PR_RANK[a.priority] ?? 9) - (PR_RANK[b.priority] ?? 9));
  } else if (sort === 'created') {
    tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else if (sort === 'title') {
    tasks.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fr', { sensitivity: 'base' }));
  } else {
    // due — déjà trié à la requête, mais on refait au cas où
    tasks.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date) - new Date(b.due_date);
    });
  }

  if (tasks.length === 0) {
    container.innerHTML = '<p class="empty">Aucune tâche.</p>';
    return;
  }

  // Cleanup d'object URLs précédents pour libérer la mémoire
  if (state._coverUrls) {
    state._coverUrls.forEach(u => URL.revokeObjectURL(u));
  }
  state._coverUrls = [];

  const today = new Date(new Date().toDateString());
  container.innerHTML = tasks.map(t => {
    const st = STATUS_LABEL[t.status];
    const pr = PRIORITY_LABEL[t.priority];
    const taskAssignees = assigneesOf(t.id);
    const due = t.due_date ? new Date(t.due_date).toLocaleDateString('fr-FR') : '';
    const dueDate = t.due_date ? new Date(t.due_date) : null;
    const dDays = dueDate ? Math.round((dueDate - today) / 86400000) : null;
    const overdue = dueDate && t.status !== 'done' && dueDate < today;
    const dueSoon = dueDate && t.status !== 'done' && !overdue && dDays !== null && dDays <= 3;
    const dueChipCls = overdue ? 'chip-danger' : dueSoon ? 'chip-warn' : '';
    const dueLabel  = overdue ? `<i data-lucide="alert-triangle"></i> ${due}` : dueSoon ? `<i data-lucide="clock"></i> ${due}` : `<i data-lucide="calendar"></i> ${due}`;
    const hasCover = t.cover_file_id && state.serverUrl;

    const assigneesHtml = taskAssignees.length === 0
      ? '<span class="row-assignee-empty">Non assignée</span>'
      : taskAssignees.slice(0, 4).map(p => avatarChip(p, 'row-avatar')).join('')
        + (taskAssignees.length > 4 ? `<span class="row-avatar row-avatar-more">+${taskAssignees.length - 4}</span>` : '');

    return `
      <div class="task-row task-open" data-id="${t.id}">
        <div class="row-cover">
          ${hasCover
            ? `<img alt="" loading="lazy" data-cover-id="${t.cover_file_id}">`
            : `<span class="row-cover-icon"><i data-lucide="clipboard-list"></i></span>`}
        </div>
        <div class="row-main">
          <div class="row-title-line">
            <h3 class="row-title">${escapeHtml(t.title)}</h3>
            <button type="button" class="status-pill status-cycle ${st.cls}" data-cycle="${t.id}" data-status="${t.status}" title="Cliquer pour changer le statut">${st.label}</button>
          </div>
          <div class="row-meta">
            <span class="badge ${pr.cls}">${pr.label}</span>
            ${t.project ? `<span class="chip"><i data-lucide="hard-hat"></i> ${escapeHtml(t.project)}</span>` : ''}
            ${due ? `<span class="chip ${dueChipCls}">${dueLabel}</span>` : ''}
          </div>
        </div>
        <div class="row-assignees">${assigneesHtml}</div>
        <div class="row-chevron">›</div>
      </div>`;
  }).join('');
  // Charger les images de couverture (auth)
  hydrateCoverImages(container);
}

function avatarChip(profile, cls) {
  const title = escapeHtml(profile.full_name + (profile.title ? ` · ${profile.title}` : ''));
  const ini = escapeHtml(initials(profile.full_name));
  const href = `profil-public.html?id=${profile.id}`;
  // onclick stop : évite d'ouvrir le détail de tâche en même temps
  const stop = `onclick="event.stopPropagation()"`;
  if (profile.avatar_file_id && state.serverUrl) {
    return `<a class="${cls}" title="${title}" href="${href}" ${stop}><img data-cover-id="${profile.avatar_file_id}" alt=""></a>`;
  }
  return `<a class="${cls}" title="${title}" href="${href}" ${stop}>${ini}</a>`;
}

function initials(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Charge une image via fetch authentifié (le header Bearer ne peut pas être passé sur <img src>)
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
    const url = URL.createObjectURL(blob);
    state._coverUrls = state._coverUrls || [];
    state._coverUrls.push(url);
    imgEl.src = url;
  } catch (e) {
    imgEl.style.display = 'none';
    if (imgEl.parentElement) imgEl.parentElement.classList.add('row-cover-empty');
  }
}

// À appeler après renderTasks ou openTaskDetail pour charger les images authentifiées
function hydrateCoverImages(rootEl) {
  rootEl.querySelectorAll('img[data-cover-id]').forEach(img => {
    if (img.src) return; // déjà chargé
    const fileId = img.dataset.coverId;
    loadAuthedImage(img, fileId);
  });
}

function firstName(full) {
  return String(full || '').split(/\s+/)[0];
}

// ---------- UI bindings ----------
function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // ----- Vue par membre : grille → détail membre -----
  const grid = document.getElementById('membersGrid');
  if (grid) grid.addEventListener('click', (e) => {
    const card = e.target.closest('.member-card');
    if (!card) return;
    state.viewMember = card.dataset.userId;
    renderAll();
  });

  const backBtn = document.getElementById('memberBackBtn');
  if (backBtn) backBtn.addEventListener('click', () => {
    state.viewMember = null;
    renderAll();
  });

  // Cocher / décocher une tâche dans la vue membre
  const projects = document.getElementById('memberProjects');
  if (projects) {
    projects.addEventListener('change', async (e) => {
      const cb = e.target.closest('.mt-check');
      if (!cb) return;
      const taskId = cb.dataset.taskId;
      const newStatus = cb.checked ? 'done' : 'todo';
      // Optimisme : la jauge bouge avant la confirmation serveur
      cb.disabled = true;
      const { error } = await sb.from('tasks').update({ status: newStatus }).eq('id', taskId);
      cb.disabled = false;
      if (error) {
        alert('Erreur : ' + error.message);
        cb.checked = !cb.checked;  // rollback visuel
      }
      // Le realtime déclenchera renderAll() qui mettra à jour la jauge
    });
    // Clic sur le titre de tâche → ouvre le détail
    projects.addEventListener('click', (e) => {
      const titleBtn = e.target.closest('.mt-task-title');
      if (titleBtn) openTaskDetail(titleBtn.dataset.openId);
    });
  }

  // Boutons "+ Nouvelle tâche" (admin uniquement)
  const ntb = document.getElementById('newTaskBtn');
  if (ntb) ntb.addEventListener('click', () => openTaskModal());
  const mntb = document.getElementById('memberNewTaskBtn');
  if (mntb) mntb.addEventListener('click', () => openTaskModal());

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
  const hasCover = task.cover_file_id && state.serverUrl;
  const folder = task.folder_id ? state.folders.find(f => f.id === task.folder_id) : null;
  const created  = task.created_at ? new Date(task.created_at) : null;
  const updated  = task.updated_at ? new Date(task.updated_at) : null;
  const overdue  = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date(new Date().toDateString());

  const progressPct = task.status === 'todo' ? 0 : task.status === 'in_progress' ? 50 : 100;
  const creatorName = state.profilesById[task.created_by]?.full_name || '—';

  const assigneesHtml = taskAssignees.length === 0
    ? '<span class="chip chip-muted">Non assignée</span>'
    : taskAssignees.map(p => `
        <span class="assignee-pill">
          ${avatarChip(p, 'assignee-avatar')}
          <span>${escapeHtml(p.full_name)}${p.title ? ` <small>· ${escapeHtml(p.title)}</small>` : ''}</span>
        </span>`).join('');

  const isAdmin = state.me?.role === 'admin';

  document.getElementById('taskDetailHead').innerHTML = `
    ${hasCover ? `<div class="detail-cover"><img alt="" data-cover-id="${task.cover_file_id}"></div>` : ''}
    <div class="detail-head">
      <h3>${escapeHtml(task.title)}</h3>
      <div class="detail-chips">
        <span class="badge ${pr.cls}">${pr.label}</span>
        ${task.project ? `<span class="chip"><i data-lucide="hard-hat"></i> ${escapeHtml(task.project)}</span>` : ''}
        ${folder ? `<a class="chip chip-folder" href="files.html"><i data-lucide="folder"></i> ${escapeHtml(folder.name)}</a>` : ''}
        ${due ? `<span class="chip ${overdue ? 'chip-danger' : ''}"><i data-lucide="calendar"></i> ${due}${overdue ? ' (en retard)' : ''}</span>` : ''}
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
          <button class="status-btn ${task.status==='done'?'status-btn-active':''}" data-status="done"><i data-lucide="check-circle-2"></i> Terminée</button>
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
          ${due ? `<li><span class="tl-icon">${overdue ? "<i data-lucide=\"alert-triangle\"></i>" : "<i data-lucide=\"calendar\"></i>"}</span><span class="tl-text"><strong>Échéance</strong> ${due}${overdue ? ' — <span class="tl-overdue">en retard</span>' : ''}</span></li>` : ''}
          ${task.status === 'done' && updated ? `<li><span class="tl-icon"><i data-lucide="check-circle-2"></i></span><span class="tl-text"><strong>Marquée terminée</strong> le ${updated.toLocaleDateString('fr-FR')}</span></li>` : ''}
        </ul>
      </div>

      <div class="detail-actions">
        <button class="btn-ghost" id="detailEdit"><i data-lucide="pen"></i> Modifier</button>
        ${isAdmin ? `<button class="btn-ghost btn-danger" id="detailDelete"><i data-lucide="trash-2"></i> Supprimer</button>` : ''}
      </div>
    </div>`;

  const detailHead = document.getElementById('taskDetailHead');
  hydrateCoverImages(detailHead);
  window.gcbtp?.renderIcons?.();

  // Lier les nouveaux boutons
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
      ${mine ? `<button class="comment-delete" data-id="${c.id}" title="Supprimer"><i data-lucide="x"></i></button>` : ''}
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
    hint.innerHTML = '<i data-lucide="alert-triangle"></i> Serveur PC non configuré — l\'image de couverture sera ignorée.';
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
      fd.append('context', 'task');
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
// ---------- Export PDF ----------
function exportTasksPdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('Bibliothèque PDF non chargée — recharge la page');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  // Récupérer les tâches filtrées (mêmes filtres que renderTasks)
  const { assignee, status, search, sort } = state.filters;
  let tasks = state.tasks.slice();
  if (assignee === 'me')        tasks = tasks.filter(t => (state.assigneesByTask[t.id] || []).includes(state.me.id));
  else if (assignee !== 'all')  tasks = tasks.filter(t => (state.assigneesByTask[t.id] || []).includes(assignee));
  if (status !== 'all')          tasks = tasks.filter(t => t.status === status);
  if (search) {
    const q = search.toLowerCase();
    tasks = tasks.filter(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.project || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
    );
  }
  const PR_RANK = { high: 0, medium: 1, low: 2 };
  if (sort === 'priority') tasks.sort((a, b) => (PR_RANK[a.priority] ?? 9) - (PR_RANK[b.priority] ?? 9));
  else if (sort === 'created') tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sort === 'title') tasks.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fr'));
  else tasks.sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date) - new Date(b.due_date);
  });

  // En-tête
  doc.setFillColor(232, 119, 34);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 50, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('GCBTP — Liste des tâches', 30, 32);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const now = new Date().toLocaleString('fr-FR');
  doc.text(`Généré le ${now} · ${tasks.length} tâche${tasks.length > 1 ? 's' : ''}`, doc.internal.pageSize.getWidth() - 30, 32, { align: 'right' });

  // Tableau
  const rows = tasks.map(t => {
    const st = STATUS_LABEL[t.status]?.label || t.status;
    const pr = PRIORITY_LABEL[t.priority]?.label || t.priority;
    const assignees = (state.assigneesByTask[t.id] || []).map(uid => state.profilesById[uid]?.full_name).filter(Boolean).join(', ') || '—';
    const due = t.due_date ? new Date(t.due_date).toLocaleDateString('fr-FR') : '—';
    return [t.title || '', t.project || '—', assignees, pr, st, due];
  });

  doc.autoTable({
    startY: 70,
    head: [['Titre', 'Projet', 'Assignées', 'Priorité', 'Statut', 'Échéance']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 6 },
    columnStyles: {
      0: { cellWidth: 200 },
      1: { cellWidth: 130 },
      2: { cellWidth: 160 },
      3: { cellWidth: 60 },
      4: { cellWidth: 70 },
      5: { cellWidth: 70 }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const v = data.cell.raw;
        if (v === 'Terminée')  data.cell.styles.textColor = [22, 163, 74];
        else if (v === 'En cours') data.cell.styles.textColor = [37, 99, 235];
      }
    },
    margin: { top: 60, left: 30, right: 30, bottom: 40 },
    didDrawPage: (data) => {
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Page ${data.pageNumber}/${pageCount}`, doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 20, { align: 'center' });
    }
  });

  const filename = `GCBTP-taches-${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(filename);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
})();
