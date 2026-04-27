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
const thumbFailCache = new Set(); // file_id en échec (404/erreur disque) pour éviter les retries bruités

(async () => {
  const session = await requireAuth();
  if (!session) return;
  bindUI();

  state.me = await currentProfile();
  document.getElementById('userName').textContent = state.me?.full_name || session.user.email;
  if (state.me?.role === 'admin') {
    document.getElementById('configServerBtn').hidden = false;
    document.getElementById('newRootFolderBtn').hidden = false;
    document.getElementById('cleanupOrphansBtn').hidden = false;
    document.getElementById('reorganizeBtn').hidden = false;
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
      state.serverUrl = await window.gcbtp.cache.getServerUrl({ refresh: true });
      document.getElementById('serverStatus').textContent = state.serverUrl ? `🟢 Serveur : ${state.serverUrl}` : '🔴 Serveur non configuré';
    })
    .subscribe();
})();

// ---------- Data ----------
async function loadProfiles() {
  const data = await window.gcbtp.cache.getProfiles();
  state.profilesById = Object.fromEntries((data || []).map(p => [p.id, p]));
}

async function loadSettings() {
  state.serverUrl = await window.gcbtp.cache.getServerUrl();
}

async function loadFolders() {
  const { data, error } = await sb.from('folders').select('*').order('name');
  if (error) { console.error(error); return; }
  state.folders = data || [];
}

async function loadFiles() {
  // Page Fichiers = uniquement les fichiers projet (context null).
  // Les médias chat/avatars/covers sont stockés à part (context = 'chat'|'avatar'|'task').
  const { data, error } = await sb.from('files').select('*').is('context', null).order('created_at', { ascending: false });
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
      <div class="item item-folder" draggable="true" data-folder-id="${f.id}" data-drop-target="folder">
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
    const mime = file.mime_type || '';
    const isImage = mime.startsWith('image/');
    const isPdf = mime.includes('pdf') || /\.pdf$/i.test(file.name || '');
    const canPreview = isImage || isPdf;
    const canDelete = file.uploaded_by === state.me?.id || state.me?.role === 'admin';
    const iconHtml = isImage
      ? `<img class="item-thumb" data-thumb-id="${file.id}" alt="" loading="lazy">`
      : `<span class="item-icon">${fileIcon(file.name)}</span>`;
    return `
      <div class="item item-file ${isImage ? 'item-image' : ''}" draggable="true" data-file-id="${file.id}">
        ${iconHtml}
        <div class="item-body">
          <div class="item-name">${escapeHtml(file.name)}</div>
          <div class="item-meta">${formatBytes(file.size_bytes)} · ${escapeHtml(uploader)} · ${when}</div>
        </div>
        ${canPreview ? `<button class="item-preview" data-file-id="${file.id}" title="Aperçu">👁</button>` : ''}
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
  if (thumbFailCache.has(fileId)) { setThumbnailFallback(imgEl); return; }
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
    thumbFailCache.add(fileId);
    setThumbnailFallback(imgEl);
  }
}

function setThumbnailFallback(imgEl) {
  // Placeholder neutre pour éviter une case vide quand la miniature n'est pas disponible.
  imgEl.alt = 'Aperçu indisponible';
  imgEl.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
    '<rect width="80" height="80" rx="8" fill="#f3f4f6"/>' +
    '<path d="M16 54l14-14 9 9 11-11 14 16H16z" fill="#d1d5db"/>' +
    '<circle cx="28" cy="28" r="6" fill="#d1d5db"/>' +
    '</svg>'
  );
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

  // Folder content click (open folder, preview, download, delete)
  document.getElementById('folderContent').addEventListener('click', async (e) => {
    const folderItem = e.target.closest('.item-folder');
    const previewBtn = e.target.closest('.item-preview');
    const downloadBtn = e.target.closest('.item-download');
    const deleteBtn = e.target.closest('.item-delete');
    if (deleteBtn) {
      e.stopPropagation();
      await handleDelete(deleteBtn);
      return;
    }
    if (previewBtn) {
      e.stopPropagation();
      await handlePreview(previewBtn.dataset.fileId);
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
  document.getElementById('cleanupOrphansBtn').addEventListener('click', cleanupOrphans);
  document.getElementById('reorganizeBtn').addEventListener('click', reorganize);

  // Aperçu : fermeture (bouton ✕, clic sur la barre, Escape)
  document.getElementById('filePreviewClose').addEventListener('click', closeFilePreview);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('filePreview').hidden) closeFilePreview();
  });

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

// -----------------------------------------------------------
// Drag & drop pour déplacer fichiers / dossiers
// -----------------------------------------------------------
function setupMoveDragDrop() {
  const content = document.getElementById('folderContent');
  const breadcrumb = document.getElementById('breadcrumb');
  const tree = document.getElementById('folderTree');

  // Démarrage du drag : marquer ce qu'on déplace
  document.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.item[draggable="true"]');
    if (!item) return;
    const payload = item.dataset.fileId
      ? { type: 'file', id: item.dataset.fileId }
      : { type: 'folder', id: item.dataset.folderId };
    e.dataTransfer.setData('application/x-gcbtp-move', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('item-dragging');
  });
  document.addEventListener('dragend', (e) => {
    document.querySelectorAll('.item-dragging').forEach(el => el.classList.remove('item-dragging'));
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  });

  // Helper : extraire le payload move depuis dataTransfer (return null si pas un déplacement GCBTP)
  const getMovePayload = (e) => {
    if (!e.dataTransfer.types.includes('application/x-gcbtp-move')) return null;
    try { return JSON.parse(e.dataTransfer.getData('application/x-gcbtp-move')); }
    catch { return null; }
  };

  // Cibles de drop : dossiers dans la liste + breadcrumb + tree sidebar
  const dropZones = [content, breadcrumb, tree];
  dropZones.forEach(zone => {
    if (!zone) return;

    zone.addEventListener('dragover', (e) => {
      const target = findDropTarget(e.target);
      if (!target) return;
      // Refuser de drop un item sur lui-même
      const moveData = e.dataTransfer.types.includes('application/x-gcbtp-move');
      if (!moveData) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Highlighter la cible
      document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
      target.classList.add('drop-target');
    });

    zone.addEventListener('dragleave', (e) => {
      const target = findDropTarget(e.target);
      if (target) target.classList.remove('drop-target');
    });

    zone.addEventListener('drop', async (e) => {
      const target = findDropTarget(e.target);
      if (!target) return;
      const payload = getMovePayload(e);
      if (!payload) return;
      e.preventDefault();
      target.classList.remove('drop-target');

      const targetFolderId = target.dataset.folderId || target.dataset.id || null;
      // Pas de drop sur soi-même
      if (payload.type === 'folder' && payload.id === targetFolderId) return;

      await performMove(payload, targetFolderId);
    });
  });
}

function findDropTarget(el) {
  // Item dossier dans la grille
  const folderItem = el.closest('.item-folder[data-drop-target="folder"]');
  if (folderItem) return folderItem;
  // Lien breadcrumb (data-id sur les <a>)
  const crumb = el.closest('#breadcrumb a[data-id], #breadcrumb a:not([data-id])');
  if (crumb) return crumb;
  // Item de l'arborescence sidebar
  const treeItem = el.closest('.tree-item');
  if (treeItem) return treeItem;
  return null;
}

async function performMove(payload, targetFolderId) {
  if (!state.serverUrl) { alert('Serveur non configuré'); return; }
  const token = (await sb.auth.getSession()).data.session?.access_token;
  if (!token) { alert('Session expirée'); return; }
  try {
    const r = await fetch(`${state.serverUrl}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ type: payload.type, id: payload.id, target_folder_id: targetFolderId })
    });
    if (!r.ok) {
      const txt = await r.text();
      alert('Échec du déplacement : ' + (txt || `HTTP ${r.status}`));
      return;
    }
    // Le realtime va rafraîchir la vue automatiquement (subscription folders/files)
    // On force quand même un reload pour réactivité
    await Promise.all([loadFiles(), loadFolders()]);
    renderAll();
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

// Activer le drag-and-drop de déplacement au démarrage (une seule fois)
setupMoveDragDrop();

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

async function reorganize() {
  if (!state.serverUrl) { alert('Serveur non configuré'); return; }
  if (!confirm('Ranger automatiquement les médias chat / avatars / couvertures de tâches dans leurs sous-dossiers (_chat, _avatars, _taches) ?\n\nCette opération déplace les fichiers sur le disque et met à jour la base de données. Sans risque, mais peut prendre quelques secondes.')) return;
  const token = (await sb.auth.getSession()).data.session?.access_token;
  if (!token) { alert('Session expirée'); return; }
  try {
    const r = await fetch(`${state.serverUrl}/admin/reorganize`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) { alert('Erreur : ' + (await r.text())); return; }
    const { moved, skipped, errors } = await r.json();
    let msg = `📦 Réorganisation terminée\n\n• ${moved} fichier(s) déplacé(s)\n• ${skipped} fichier(s) ignoré(s) (déjà rangés ou non identifiés)`;
    if (errors?.length) msg += `\n• ${errors.length} erreur(s)`;
    alert(msg);
    await loadFiles();
    renderAll();
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

async function cleanupOrphans() {
  if (!state.serverUrl) { alert('Serveur non configuré'); return; }
  const token = (await sb.auth.getSession()).data.session?.access_token;
  if (!token) { alert('Session expirée'); return; }
  try {
    // 1. Lister d'abord
    const listR = await fetch(`${state.serverUrl}/admin/orphans`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!listR.ok) {
      alert('Erreur : ' + (await listR.text()));
      return;
    }
    const { count, total, orphans } = await listR.json();
    if (count === 0) { alert('🎉 Aucun fichier orphelin — tout est propre.'); return; }

    // ⚠️ Garde-fou anti-catastrophe : si > 50% des fichiers seraient supprimés,
    // c'est très probablement un problème de config pc-server (FILES_DIR pointé
    // ailleurs, disque débranché, dossier renommé). On REFUSE.
    const ratio = total > 0 ? (count / total) : 0;
    if (ratio > 0.5) {
      alert(
        `⚠️ SUPPRESSION REFUSÉE\n\n` +
        `${count} fichier(s) sur ${total} (${Math.round(ratio * 100)}%) seraient supprimés.\n\n` +
        `C'est probablement un problème de config du pc-server :\n` +
        `  • FILES_DIR pointe ailleurs ?\n` +
        `  • Disque externe débranché ?\n` +
        `  • Dossier renommé/déplacé ?\n\n` +
        `Vérifie d'abord que le pc-server lit le bon dossier.\n` +
        `Si c'est vraiment intentionnel, supprime les orphelins par lots dans Supabase.`
      );
      return;
    }

    const names = orphans.slice(0, 10).map(o => `• ${o.name}`).join('\n');
    const more = orphans.length > 10 ? `\n…et ${orphans.length - 10} autres` : '';
    if (!confirm(`${count} fichier(s) orphelin(s) en DB sans fichier physique :\n\n${names}${more}\n\nLes supprimer définitivement de la base ?`)) return;

    // Double confirmation au-delà de 10 fichiers
    if (count > 10) {
      const typed = prompt(`Pour confirmer la suppression de ${count} entrée(s), tape SUPPRIMER :`);
      if (typed === null || typed.trim().toUpperCase() !== 'SUPPRIMER') {
        alert('Suppression annulée.');
        return;
      }
    }

    // 2. Supprimer
    const delR = await fetch(`${state.serverUrl}/admin/orphans/cleanup`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!delR.ok) { alert('Erreur : ' + (await delR.text())); return; }
    const { deleted } = await delR.json();
    alert(`✅ ${deleted} entrée(s) supprimée(s)`);
    await loadFiles();
    renderAll();
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
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

// Compte récursif des sous-dossiers et fichiers contenus dans un dossier
function countFolderContents(folderId) {
  let subfolders = 0, files = 0;
  function walk(fid) {
    state.folders.filter(f => f.parent_id === fid).forEach(sub => {
      subfolders++;
      walk(sub.id);
    });
    files += state.files.filter(f => f.folder_id === fid).length;
  }
  walk(folderId);
  return { subfolders, files };
}

async function handleDelete(btn) {
  if (!state.serverUrl) { alert('Serveur PC non configuré'); return; }

  // ----- Suppression d'un fichier -----
  if (btn.dataset.fileId) {
    const file = state.files.find(f => f.id === btn.dataset.fileId);
    const name = file?.name || 'ce fichier';
    if (!confirm(`Supprimer le fichier "${name}" ?\n\nCette action est irréversible (le fichier sera aussi effacé du PC).`)) return;
    const token = (await sb.auth.getSession()).data.session.access_token;
    const r = await fetch(`${state.serverUrl}/file/${btn.dataset.fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) alert('Erreur de suppression : ' + (await r.text()));
    return;
  }

  // ----- Suppression d'un dossier (cascade !) -----
  if (!btn.dataset.folderId) return;
  const folder = state.folders.find(f => f.id === btn.dataset.folderId);
  if (!folder) return;
  const { subfolders, files } = countFolderContents(folder.id);
  const total = subfolders + files;

  // Confirm nominative avec compteurs
  let msg = `Supprimer le dossier "${folder.name}" ?`;
  if (total > 0) {
    msg += `\n\n⚠️ Cela supprimera AUSSI :`;
    if (subfolders > 0) msg += `\n   • ${subfolders} sous-dossier(s)`;
    if (files > 0)      msg += `\n   • ${files} fichier(s)`;
    msg += `\n\nCette action est IRRÉVERSIBLE.`;
  }
  if (!confirm(msg)) return;

  // Double confirmation par retape du nom si dossier non-trivial
  // (sous-dossiers OU > 5 fichiers : risque de cascade large)
  const dangerous = subfolders > 0 || files > 5;
  if (dangerous) {
    const typed = prompt(
      `⚠️ Suppression définitive de ${total} élément(s).\n\n` +
      `Pour confirmer, retape EXACTEMENT le nom du dossier :\n\n${folder.name}`
    );
    if (typed === null) return;
    if (typed.trim() !== folder.name) {
      alert('Suppression annulée — le nom ne correspond pas exactement.');
      return;
    }
  }

  const token = (await sb.auth.getSession()).data.session.access_token;
  const r = await fetch(`${state.serverUrl}/folder/${folder.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!r.ok) alert('Erreur de suppression : ' + (await r.text()));
}

// Aperçu PDF/image plein écran. Stream avec Bearer → blob → iframe ou img.
async function handlePreview(fileId) {
  if (!state.serverUrl) { alert('Serveur non configuré'); return; }
  const file = state.files.find(f => f.id === fileId);
  if (!file) return;
  const modal = document.getElementById('filePreview');
  const frame = document.getElementById('filePreviewFrame');
  const img   = document.getElementById('filePreviewImg');
  const title = document.getElementById('filePreviewName');
  const dl    = document.getElementById('filePreviewDl');
  title.textContent = file.name;

  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error('Session expirée');
    const r = await fetch(`${state.serverUrl}/stream/${fileId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);

    // Nettoyer l'éventuelle blob URL précédente
    if (modal.dataset.blobUrl) URL.revokeObjectURL(modal.dataset.blobUrl);
    modal.dataset.blobUrl = url;

    dl.href = url;
    dl.download = file.name;

    if ((file.mime_type || '').startsWith('image/')) {
      frame.removeAttribute('src'); frame.hidden = true;
      img.src = url; img.hidden = false;
    } else {
      img.removeAttribute('src'); img.hidden = true;
      frame.src = url; frame.hidden = false;
    }
    modal.hidden = false;
    document.body.classList.add('no-scroll');
  } catch (e) {
    alert('Aperçu impossible : ' + e.message);
  }
}

function closeFilePreview() {
  const modal = document.getElementById('filePreview');
  if (!modal || modal.hidden) return;
  const frame = document.getElementById('filePreviewFrame');
  const img   = document.getElementById('filePreviewImg');
  frame.removeAttribute('src'); frame.hidden = true;
  img.removeAttribute('src'); img.hidden = true;
  if (modal.dataset.blobUrl) {
    URL.revokeObjectURL(modal.dataset.blobUrl);
    delete modal.dataset.blobUrl;
  }
  modal.hidden = true;
  document.body.classList.remove('no-scroll');
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

// Limites côté client (alignées sur le pc-server : 100 Mo par fichier)
const MAX_FILE_SIZE = 100 * 1024 * 1024;       // 100 Mo
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;       // 5 minutes par fichier
const PARALLEL_UPLOADS = 3;                    // 3 uploads simultanés max

async function handleUpload(items) {
  if (!state.serverUrl) { alert('Serveur non configuré — contacte l\'admin'); return; }
  if (!items || items.length === 0) return;

  // Pré-filtrage : retirer les fichiers trop gros
  const tooBig = items.filter(it => it.file.size > MAX_FILE_SIZE);
  if (tooBig.length > 0) {
    const names = tooBig.map(it => `• ${it.relativePath || it.file.name} (${formatBytes(it.file.size)})`).join('\n');
    const cont = confirm(
      `${tooBig.length} fichier(s) dépassent la limite de 100 Mo et seront ignorés :\n\n${names}\n\nContinuer avec les autres fichiers ?`
    );
    if (!cont) return;
    items = items.filter(it => it.file.size <= MAX_FILE_SIZE);
    if (items.length === 0) return;
  }

  const token = (await sb.auth.getSession()).data.session?.access_token;
  if (!token) { alert('Session expirée — reconnecte-toi'); return; }

  const progress = document.getElementById('uploadProgress');
  progress.hidden = false;
  progress.innerHTML = '';

  // Bandeau de progression global toujours visible en haut
  const banner = document.createElement('div');
  banner.className = 'upload-banner';
  banner.innerHTML = `
    <div class="upload-banner-text">📤 Préparation…</div>
    <div class="upload-banner-bar"><div class="upload-banner-fill"></div></div>
  `;
  progress.appendChild(banner);
  const setBanner = (text, pct) => {
    banner.querySelector('.upload-banner-text').textContent = text;
    if (typeof pct === 'number') banner.querySelector('.upload-banner-fill').style.width = `${pct}%`;
  };

  // 1. Construire l'arbre des dossiers à créer (uniques)
  const folderPaths = new Set();
  for (const it of items) {
    const parts = (it.relativePath || it.file.name).split('/');
    parts.pop();
    let acc = '';
    for (const p of parts) {
      if (!p) continue;
      acc = acc ? `${acc}/${p}` : p;
      folderPaths.add(acc);
    }
  }

  // 2. Créer les dossiers en DB, parents d'abord
  const sortedPaths = [...folderPaths].sort((a, b) => a.split('/').length - b.split('/').length);
  const folderIdByPath = {};
  if (sortedPaths.length > 0) {
    const headLine = document.createElement('div');
    headLine.className = 'upload-line';
    headLine.innerHTML = `<span>📂 ${sortedPaths.length} dossier(s) à créer</span><span class="upload-status">⏳ 0/${sortedPaths.length}</span>`;
    progress.appendChild(headLine);
    const headStatus = headLine.querySelector('.upload-status');

    for (let i = 0; i < sortedPaths.length; i++) {
      const path = sortedPaths[i];
      const parts = path.split('/');
      const name = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');
      const parentId = parentPath ? folderIdByPath[parentPath] : (state.currentFolderId || null);
      setBanner(`📂 Création de l'arborescence : ${i + 1}/${sortedPaths.length}`, ((i + 1) / sortedPaths.length) * 30);
      headStatus.textContent = `⏳ ${i + 1}/${sortedPaths.length}`;
      try {
        // Timeout de 15s par insert pour éviter de bloquer la chaîne
        const insertPromise = sb.from('folders').insert({
          name,
          parent_id: parentId,
          created_by: state.me.id,
          status: 'todo'
        }).select('id').single();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout création dossier')), 15000));
        const { data, error } = await Promise.race([insertPromise, timeoutPromise]);
        if (error) throw error;
        folderIdByPath[path] = data.id;
      } catch (err) {
        console.warn('Folder create error for', path, err.message);
        // On continue avec les autres dossiers — les fichiers atterriront à la racine
      }
    }
    headStatus.textContent = '✅';
    headStatus.className = 'upload-status ok';
  }

  // 3. Uploader avec parallélisme limité (PARALLEL_UPLOADS à la fois)
  let done = 0;
  const total = items.length;
  const queue = items.slice();
  setBanner(`📤 Upload : 0/${total}`, 30);
  const workers = Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, async () => {
    while (queue.length > 0) {
      const it = queue.shift();
      if (!it) break;

      const path = it.relativePath || it.file.name;
      const parts = path.split('/');
      const folderPath = parts.slice(0, -1).join('/');
      const folderId = folderPath ? folderIdByPath[folderPath] : (state.currentFolderId || null);

      const line = document.createElement('div');
      line.className = 'upload-line';
      const sizeLabel = formatBytes(it.file.size);
      line.innerHTML = `<span>${escapeHtml(path)} <em class="upload-size">${sizeLabel}</em></span><span class="upload-status">⏳ En cours…</span>`;
      progress.appendChild(line);

      const fd = new FormData();
      fd.append('file', it.file);
      if (folderId) fd.append('folder_id', folderId);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);

      try {
        const r = await fetch(`${state.serverUrl}/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd,
          signal: ctrl.signal
        });
        if (r.ok) {
          line.querySelector('.upload-status').textContent = '✅ OK';
          line.querySelector('.upload-status').className = 'upload-status ok';
        } else {
          let txt = await r.text().catch(() => '');
          if (r.status === 413) txt = 'Fichier trop volumineux (>100 Mo)';
          else if (r.status === 401) txt = 'Session expirée';
          else if (r.status === 502 || r.status === 503 || r.status === 504) txt = 'Serveur PC injoignable (tunnel ?)';
          line.querySelector('.upload-status').textContent = '❌ ' + (txt.slice(0, 80) || `HTTP ${r.status}`);
          line.querySelector('.upload-status').className = 'upload-status err';
        }
      } catch (err) {
        const msg = err.name === 'AbortError'
          ? 'Délai dépassé (timeout)'
          : err.message?.includes('Failed to fetch')
            ? 'Connexion serveur perdue'
            : err.message || 'Erreur inconnue';
        line.querySelector('.upload-status').textContent = '❌ ' + msg;
        line.querySelector('.upload-status').className = 'upload-status err';
      } finally {
        clearTimeout(timer);
        done++;
        const pct = 30 + Math.round((done / total) * 70);
        setBanner(`📤 Upload : ${done}/${total}`, pct);
      }
    }
  });
  await Promise.all(workers);
  setBanner(`✅ Terminé : ${done}/${total}`, 100);

  // Récap
  const recap = document.createElement('div');
  recap.className = 'upload-line upload-recap';
  const errors = progress.querySelectorAll('.upload-status.err').length;
  recap.innerHTML = errors === 0
    ? `<span>🎉 ${total} fichier(s) uploadé(s) avec succès</span>`
    : `<span>⚠️ ${total - errors}/${total} OK — ${errors} en erreur</span>`;
  progress.appendChild(recap);

  setTimeout(() => { progress.hidden = true; }, 8000);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
})();
