(() => {
const { sb, requireAuth, logout, currentProfile } = window.gcbtp;

let state = {
  me: null,
  profilesById: {},
  folders: [],
  files: [],
  currentFolderId: null,
  serverUrl: null,
  search: '',
  sort: 'recent'
};
const thumbCache = new Map(); // file_id → blob URL pour vignettes images

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
  let subFolders = state.folders.filter(f =>
    state.currentFolderId ? f.parent_id === state.currentFolderId : !f.parent_id
  );
  let filesHere = state.files.filter(f => f.folder_id === state.currentFolderId);

  document.getElementById('currentFolderTitle').textContent = current ? current.name : 'Racine';
  document.getElementById('folderActions').hidden = !current;

  if (current) {
    document.getElementById('folderStatus').value = current.status;
  }

  // Recherche
  if (state.search) {
    const q = state.search.toLowerCase();
    subFolders = subFolders.filter(f => (f.name || '').toLowerCase().includes(q));
    filesHere = filesHere.filter(f => (f.name || '').toLowerCase().includes(q));
  }

  // Tri
  if (state.sort === 'name') {
    subFolders.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }));
    filesHere.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }));
  } else if (state.sort === 'size') {
    filesHere.sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0));
  } else {
    // recent
    filesHere.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    subFolders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  const box = document.getElementById('folderContent');
  if (subFolders.length === 0 && filesHere.length === 0) {
    box.innerHTML = state.search
      ? '<p class="empty">Aucun résultat pour cette recherche.</p>'
      : '<p class="empty">Ce dossier est vide. Crée un sous-dossier ou dépose des fichiers.</p>';
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
    const isImage = (file.mime_type || '').startsWith('image/');
    const canDelete = file.uploaded_by === state.me?.id || state.me?.role === 'admin';
    const iconHtml = isImage
      ? `<img class="item-thumb" data-thumb-id="${file.id}" alt="" loading="lazy">`
      : `<span class="item-icon">${fileIcon(file.name)}</span>`;
    return `
      <div class="item item-file ${isImage ? 'item-image' : ''}" data-file-id="${file.id}">
        ${iconHtml}
        <div class="item-body">
          <div class="item-name">${escapeHtml(file.name)}</div>
          <div class="item-meta">${formatBytes(file.size_bytes)} · ${escapeHtml(uploader)} · ${when}</div>
        </div>
        <button class="item-download" data-file-id="${file.id}" title="Télécharger">⬇</button>
        ${canDelete ? `<button class="item-delete" data-file-id="${file.id}" title="Supprimer">×</button>` : ''}
      </div>`;
  }).join('');

  box.innerHTML = foldersHtml + filesHtml;
  // Hydrater les vignettes
  box.querySelectorAll('img.item-thumb').forEach(img => loadThumbnail(img, img.dataset.thumbId));
}

async function loadThumbnail(imgEl, fileId) {
  if (!state.serverUrl || !fileId) return;
  if (thumbCache.has(fileId)) { imgEl.src = thumbCache.get(fileId); return; }
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) return;
    const r = await fetch(`${state.serverUrl}/stream/${fileId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    thumbCache.set(fileId, url);
    imgEl.src = url;
  } catch (e) {
    imgEl.style.display = 'none';
  }
}

function formatBytes(n) {
  if (!n || n < 0) return '';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
}
function fileIcon(name) {
  const ext = (name || '').toLowerCase().split('.').pop();
  if (ext === 'pdf') return '📕';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  if (['mp4', 'mov', 'webm', 'avi'].includes(ext)) return '🎞️';
  if (['mp3', 'wav', 'm4a', 'webm', 'ogg'].includes(ext)) return '🎵';
  if (['txt', 'md'].includes(ext)) return '📄';
  return '📄';
}

// ---------- UI ----------
function bindUI() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Recherche
  const search = document.getElementById('searchFiles');
  if (search) {
    let t;
    search.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.search = e.target.value.trim();
        renderFolderContent();
      }, 150);
    });
  }
  const sortSel = document.getElementById('sortFiles');
  if (sortSel) sortSel.addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderFolderContent();
  });

  // Breadcrumb navigation
  document.getElementById('breadcrumb').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    state.currentFolderId = a.dataset.id || null;
    state.search = '';
    const s = document.getElementById('searchFiles'); if (s) s.value = '';
    renderAll();
  });

  // Tree navigation
  document.getElementById('folderTree').addEventListener('click', (e) => {
    const item = e.target.closest('.tree-item');
    if (!item) return;
    state.currentFolderId = item.dataset.folderId;
    state.search = '';
    const s = document.getElementById('searchFiles'); if (s) s.value = '';
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
  const folderInput = document.getElementById('folderInput');
  const pickFilesBtn = document.getElementById('pickFilesBtn');
  const pickFolderBtn = document.getElementById('pickFolderBtn');

  // Boutons de la dropzone (sans déclencher le clic global du dropzone)
  pickFilesBtn?.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  pickFolderBtn?.addEventListener('click', (e) => { e.stopPropagation(); folderInput.click(); });

  // Sélection de fichiers individuels
  fileInput.addEventListener('change', (e) => {
    const items = Array.from(e.target.files).map(f => ({ file: f, relativePath: f.name }));
    handleUpload(items);
    fileInput.value = '';
  });
  // Sélection d'un dossier complet (avec arborescence)
  folderInput.addEventListener('change', (e) => {
    const items = Array.from(e.target.files).map(f => ({ file: f, relativePath: f.webkitRelativePath || f.name }));
    handleUpload(items);
    folderInput.value = '';
  });

  // Drag & drop : supporte fichiers ET dossiers
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dropzone-active'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dropzone-active'));
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dropzone-active');
    const items = e.dataTransfer.items;
    if (items && typeof items[0]?.webkitGetAsEntry === 'function') {
      // Browser supporte la FileSystem API → on peut walker dans les dossiers
      const all = [];
      const promises = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) promises.push(walkEntry(entry, '', all));
      }
      await Promise.all(promises);
      if (all.length) handleUpload(all);
    } else {
      // Fallback : juste les fichiers (pas les dossiers)
      const files = Array.from(e.dataTransfer.files).map(f => ({ file: f, relativePath: f.name }));
      handleUpload(files);
    }
  });
}

// Parcours récursif d'une FileSystemEntry (fichier ou dossier)
async function walkEntry(entry, basePath, out) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        out.push({ file, relativePath: basePath + file.name });
        resolve();
      }, () => resolve());
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const folderPath = basePath + entry.name + '/';
    // readEntries peut être appelé plusieurs fois jusqu'à recevoir un tableau vide
    const readAll = () => new Promise((resolve) => {
      const results = [];
      const next = () => reader.readEntries(async (batch) => {
        if (!batch.length) return resolve(results);
        results.push(...batch);
        next();
      }, () => resolve(results));
      next();
    });
    const children = await readAll();
    await Promise.all(children.map(c => walkEntry(c, folderPath, out)));
  }
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
  if (!confirm('Supprimer cet élément ?\n(Les fichiers seront aussi supprimés du PC)')) return;
  if (!state.serverUrl) { alert('Serveur PC non configuré'); return; }
  const token = (await sb.auth.getSession()).data.session.access_token;

  if (btn.dataset.folderId) {
    // Suppression de dossier : passe par le serveur pour nettoyer le disque
    const r = await fetch(`${state.serverUrl}/folder/${btn.dataset.folderId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) alert('Erreur de suppression : ' + (await r.text()));
  } else if (btn.dataset.fileId) {
    const r = await fetch(`${state.serverUrl}/file/${btn.dataset.fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) alert('Erreur de suppression : ' + (await r.text()));
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

async function handleUpload(items) {
  // items : [{ file, relativePath }] — relativePath inclut éventuellement des "dossier/sous-dossier/fichier.ext"
  if (!state.serverUrl) { alert('Serveur non configuré — contacte l\'admin'); return; }
  if (!items || items.length === 0) return;

  const token = (await sb.auth.getSession()).data.session.access_token;
  const progress = document.getElementById('uploadProgress');
  progress.hidden = false;
  progress.innerHTML = '';

  // 1. Construire l'arbre des dossiers à créer (uniques)
  const folderPaths = new Set();
  for (const it of items) {
    const parts = (it.relativePath || it.file.name).split('/');
    parts.pop(); // enlever le nom de fichier
    let acc = '';
    for (const p of parts) {
      if (!p) continue;
      acc = acc ? `${acc}/${p}` : p;
      folderPaths.add(acc);
    }
  }

  // 2. Créer les dossiers en DB, parents d'abord (tri par profondeur)
  const sortedPaths = [...folderPaths].sort((a, b) => a.split('/').length - b.split('/').length);
  const folderIdByPath = {};
  if (sortedPaths.length > 0) {
    const headLine = document.createElement('div');
    headLine.className = 'upload-line';
    headLine.innerHTML = `<span>📂 Création de ${sortedPaths.length} dossier(s)…</span><span class="upload-status">⏳</span>`;
    progress.appendChild(headLine);

    for (const path of sortedPaths) {
      const parts = path.split('/');
      const name = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');
      const parentId = parentPath ? folderIdByPath[parentPath] : (state.currentFolderId || null);
      try {
        const { data, error } = await sb.from('folders').insert({
          name,
          parent_id: parentId,
          created_by: state.me.id,
          status: 'todo'
        }).select('id').single();
        if (error) throw error;
        folderIdByPath[path] = data.id;
      } catch (err) {
        console.error('Folder create error for', path, err);
      }
    }
    headLine.querySelector('.upload-status').textContent = '✅';
    headLine.querySelector('.upload-status').className = 'upload-status ok';
  }

  // 3. Uploader chaque fichier dans son dossier de destination
  for (const it of items) {
    const path = it.relativePath || it.file.name;
    const parts = path.split('/');
    const folderPath = parts.slice(0, -1).join('/');
    const folderId = folderPath
      ? folderIdByPath[folderPath]
      : (state.currentFolderId || null);

    const line = document.createElement('div');
    line.className = 'upload-line';
    line.innerHTML = `<span>${escapeHtml(path)}</span><span class="upload-status">⏳ En cours…</span>`;
    progress.appendChild(line);

    const fd = new FormData();
    fd.append('file', it.file);
    if (folderId) fd.append('folder_id', folderId);

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

  setTimeout(() => { progress.hidden = true; }, 6000);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
})();
