(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

let state = {
  me: null,
  profilesById: {},
  folders: [],
  files: [],
  currentFolderId: null,
  serverUrl: null
};

(async () => {
  const session = await requireAuth();
  if (!session) return;
  bindUI();

  state.me = await currentProfile();
  document.getElementById('userName').textContent = state.me?.full_name || session.user.email;
  if (state.me?.role === 'admin') {
    document.getElementById('configServerBtn').hidden = false;
    document.getElementById('newRootFolderBtn').hidden = false;
  }

  await Promise.all([loadProfiles(), loadSettings(), loadFolders(), loadFiles()]);
  renderAll();

  // Realtime
  sb.channel('folders-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'folders' }, async () => {
      await loadFolders(); renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, async () => {
      await loadFiles(); renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, async () => {
      await loadSettings();
      document.getElementById('serverStatus').textContent = state.serverUrl ? `🟢 Serveur : ${state.serverUrl}` : '🔴 Serveur non configuré';
    })
    .subscribe();
})();

// ---------- Data ----------
async function loadProfiles() {
  const { data } = await sb.from('profiles').select('id, full_name');
  state.profilesById = Object.fromEntries((data || []).map(p => [p.id, p]));
}

async function loadSettings() {
  const { data } = await sb.from('app_settings').select('*').eq('key', 'file_server_url').maybeSingle();
  state.serverUrl = data?.value || null;
}

async function loadFolders() {
  const { data, error } = await sb.from('folders').select('*').order('name');
  if (error) { console.error(error); return; }
  state.folders = data || [];
}

async function loadFiles() {
  const { data, error } = await sb.from('files').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  state.files = data || [];
}

// ---------- Render ----------
function renderAll() {
  document.getElementById('serverStatus').textContent = state.serverUrl ? `🟢 Serveur : ${state.serverUrl}` : '🔴 Serveur non configuré';
  renderBreadcrumb();
  renderTree();
  renderFolderContent();
}

function renderBreadcrumb() {
  const crumbs = [];
  let id = state.currentFolderId;
  while (id) {
    const f = state.folders.find(x => x.id === id);
    if (!f) break;
    crumbs.unshift(f);
    id = f.parent_id;
  }
  const el = document.getElementById('breadcrumb');
  el.innerHTML = `<a href="#" data-id="">🏠 Racine</a>` +
    crumbs.map(c => ` / <a href="#" data-id="${c.id}">${escapeHtml(c.name)}</a>`).join('');
}

function renderTree() {
  const el = document.getElementById('folderTree');
  const roots = state.folders.filter(f => !f.parent_id);
  el.innerHTML = roots.length === 0
    ? '<p class="empty">Aucun dossier pour le moment.</p>'
    : `<ul class="tree">${roots.map(renderBranch).join('')}</ul>`;
}

function renderBranch(folder) {
  const children = state.folders.filter(f => f.parent_id === folder.id);
  const st = STATUS_MAP[folder.status];
  const active = folder.id === state.currentFolderId;
  return `
    <li>
      <div class="tree-item ${active ? 'tree-active' : ''}" data-folder-id="${folder.id}">
        <span class="tree-icon">📁</span>
        <span class="tree-name">${escapeHtml(folder.name)}</span>
        <span class="badge ${st.cls}">${st.label}</span>
      </div>
      ${children.length ? `<ul>${children.map(renderBranch).join('')}</ul>` : ''}
    </li>`;
}

const STATUS_MAP = {
  todo:        { label: 'À faire',  cls: 'prio-low' },
  in_progress: { label: 'En cours', cls: 'prio-medium' },
  done:        { label: 'Terminé',  cls: 'status-done' }
};

function renderFolderContent() {
  const current = state.folders.find(f => f.id === state.currentFolderId);
  const subFolders = state.folders.filter(f =>
    state.currentFolderId ? f.parent_id === state.currentFolderId : !f.parent_id
  );
  const filesHere = state.files.filter(f => f.folder_id === state.currentFolderId);

  document.getElementById('currentFolderTitle').textContent = current ? current.name : 'Racine';
  document.getElementById('folderActions').hidden = !current;

  if (current) {
    document.getElementById('folderStatus').value = current.status;
  }

  const box = document.getElementById('folderContent');
  if (subFolders.length === 0 && filesHere.length === 0) {
    box.innerHTML = '<p class="empty">Ce dossier est vide. Crée un sous-dossier ou dépose des fichiers.</p>';
    return;
  }

  const foldersHtml = subFolders.map(f => {
    const st = STATUS_MAP[f.status];
    return `
      <div class="item item-folder" data-folder-id="${f.id}">
        <div class="item-icon">📁</div>
        <div class="item-body">
          <div class="item-name">${escapeHtml(f.name)}</div>
          <div class="item-meta"><span class="badge ${st.cls}">${st.label}</span></div>
        </div>
        ${state.me?.role === 'admin' ? `<button class="item-delete" data-folder-id="${f.id}" title="Supprimer">×</button>` : ''}
      </div>`;
  }).join('');

  const filesHtml = filesHere.map(file => {
    const uploader = state.profilesById[file.uploaded_by]?.full_name || '—';
    const when = new Date(file.created_at).toLocaleDateString('fr-FR');
    const sizeMb = (file.size_bytes / 1024 / 1024).toFixed(2);
    const isImage = (file.mime_type || '').startsWith('image/');
    const canDelete = file.uploaded_by === state.me?.id || state.me?.role === 'admin';
    return `
      <div class="item item-file" data-file-id="${file.id}">
        <div class="item-icon">${isImage ? '🖼️' : '📄'}</div>
        <div class="item-body">
          <div class="item-name">${escapeHtml(file.name)}</div>
          <div class="item-meta">${sizeMb} Mo · ${escapeHtml(uploader)} · ${when}</div>
        </div>
        <button class="item-download" data-file-id="${file.id}" title="Télécharger">⬇</button>
        ${canDelete ? `<button class="item-delete" data-file-id="${file.id}" title="Supprimer">×</button>` : ''}
      </div>`;
  }).join('');

  box.innerHTML = foldersHtml + filesHtml;
}

// ---------- UI ----------
function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Breadcrumb navigation
  document.getElementById('breadcrumb').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    state.currentFolderId = a.dataset.id || null;
    renderAll();
  });

  // Tree navigation
  document.getElementById('folderTree').addEventListener('click', (e) => {
    const item = e.target.closest('.tree-item');
    if (!item) return;
    state.currentFolderId = item.dataset.folderId;
    renderAll();
  });

  // Folder content click (open folder, download, delete)
  document.getElementById('folderContent').addEventListener('click', async (e) => {
    const folderItem = e.target.closest('.item-folder');
    const downloadBtn = e.target.closest('.item-download');
    const deleteBtn = e.target.closest('.item-delete');
    if (deleteBtn) {
      e.stopPropagation();
      await handleDelete(deleteBtn);
      return;
    }
    if (downloadBtn) {
      e.stopPropagation();
      await handleDownload(downloadBtn.dataset.fileId);
      return;
    }
    if (folderItem) {
      state.currentFolderId = folderItem.dataset.folderId;
      renderAll();
    }
  });

  // New root folder (admin)
  document.getElementById('newRootFolderBtn').addEventListener('click', () => createFolder(null));
  // New subfolder
  document.getElementById('newSubFolderBtn').addEventListener('click', () => createFolder(state.currentFolderId));
  // Change folder status
  document.getElementById('folderStatus').addEventListener('change', async (e) => {
    if (!state.currentFolderId) return;
    const { error } = await sb.from('folders').update({ status: e.target.value }).eq('id', state.currentFolderId);
    if (error) alert('Erreur : ' + error.message);
  });

  // Config server (admin)
  document.getElementById('configServerBtn').addEventListener('click', configServer);

  // Upload
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleUpload(Array.from(e.target.files)));
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dropzone-active'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dropzone-active'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dropzone-active');
    handleUpload(Array.from(e.dataTransfer.files));
  });
}

async function createFolder(parentId) {
  const name = prompt(parentId ? 'Nom du sous-dossier :' : 'Nom du nouveau dossier :');
  if (!name?.trim()) return;
  const { error } = await sb.from('folders').insert({
    name: name.trim(),
    parent_id: parentId,
    created_by: state.me.id,
    status: 'todo'
  });
  if (error) alert('Erreur : ' + error.message);
}

async function configServer() {
  const current = state.serverUrl || '';
  const url = prompt('URL du tunnel Cloudflare (ex. https://abc-xyz.trycloudflare.com) :', current);
  if (url === null) return;
  const clean = url.trim().replace(/\/$/, '');
  const { error } = await sb.from('app_settings').upsert({
    key: 'file_server_url',
    value: clean,
    updated_by: state.me.id,
    updated_at: new Date().toISOString()
  });
  if (error) alert('Erreur : ' + error.message);
}

async function handleDelete(btn) {
  if (!confirm('Supprimer cet élément ?')) return;
  if (btn.dataset.folderId) {
    const { error } = await sb.from('folders').delete().eq('id', btn.dataset.folderId);
    if (error) alert('Erreur : ' + error.message);
  } else if (btn.dataset.fileId) {
    // Supprimer via le serveur PC (qui supprime disque + DB)
    if (!state.serverUrl) { alert('Serveur non configuré'); return; }
    const token = (await sb.auth.getSession()).data.session.access_token;
    const r = await fetch(`${state.serverUrl}/file/${btn.dataset.fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) { alert('Erreur de suppression : ' + (await r.text())); }
  }
}

async function handleDownload(fileId) {
  if (!state.serverUrl) { alert('Serveur non configuré'); return; }
  const token = (await sb.auth.getSession()).data.session.access_token;
  const r = await fetch(`${state.serverUrl}/download/${fileId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!r.ok) { alert('Erreur de téléchargement'); return; }
  const blob = await r.blob();
  const file = state.files.find(f => f.id === fileId);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file?.name || 'fichier';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function handleUpload(files) {
  if (!state.serverUrl) { alert('Serveur non configuré — contacte l\'admin'); return; }
  if (files.length === 0) return;

  const token = (await sb.auth.getSession()).data.session.access_token;
  const progress = document.getElementById('uploadProgress');
  progress.hidden = false;
  progress.innerHTML = '';

  for (const file of files) {
    const line = document.createElement('div');
    line.className = 'upload-line';
    line.innerHTML = `<span>${escapeHtml(file.name)}</span><span class="upload-status">⏳ En cours…</span>`;
    progress.appendChild(line);

    const fd = new FormData();
    fd.append('file', file);
    if (state.currentFolderId) fd.append('folder_id', state.currentFolderId);

    try {
      const r = await fetch(`${state.serverUrl}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      if (r.ok) {
        line.querySelector('.upload-status').textContent = '✅ OK';
        line.querySelector('.upload-status').className = 'upload-status ok';
      } else {
        const txt = await r.text();
        line.querySelector('.upload-status').textContent = '❌ ' + txt.slice(0, 60);
        line.querySelector('.upload-status').className = 'upload-status err';
      }
    } catch (err) {
      line.querySelector('.upload-status').textContent = '❌ ' + err.message;
      line.querySelector('.upload-status').className = 'upload-status err';
    }
  }

  setTimeout(() => { progress.hidden = true; }, 4000);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
})();
