// =========================================================
// GCBTP — Serveur local pour les fichiers de chantier
// Tourne sur le PC de l'admin, exposé via Cloudflare Tunnel
// =========================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startNotifier } from './notifier.js';
import webpush from 'web-push';

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  PORT = 3000,
  FILES_DIR = 'C:\\gcbtp-files',
  CORS_ORIGIN = '*',
  MAX_FILE_MB = 100,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL ou SUPABASE_KEY manquant dans .env');
  process.exit(1);
}

// Créer le dossier de stockage s'il n'existe pas
fs.mkdirSync(FILES_DIR, { recursive: true });
console.log(`📁 Stockage : ${FILES_DIR}`);

const app = express();

// -----------------------------------------------------------
// CORS — handler manuel (fiable avec tunnels Cloudflare + Node 24)
// -----------------------------------------------------------
const allowedOrigins = CORS_ORIGIN.trim() === '*'
  ? null  // wildcard total
  : CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins === null) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    // Origine non autorisée — on log pour debug mais on ne pose pas l'en-tête
    console.warn(`⚠️  CORS bloqué : origin "${origin}" non listée dans CORS_ORIGIN`);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Content-Disposition, Accept-Ranges');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json());

// Client Supabase (anon) — utilisé pour valider les tokens utilisateurs
const sbAuth = createClient(SUPABASE_URL, SUPABASE_KEY);

// -----------------------------------------------------------
// Middleware d'authentification
// Chaque requête doit contenir un Authorization: Bearer <token>
// -----------------------------------------------------------
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data, error } = await sbAuth.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });

  // Créer un client Supabase "as user" pour respecter les RLS
  const sbUser = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  req.user = data.user;
  req.sb = sbUser;
  next();
}

// -----------------------------------------------------------
// Helpers de stockage en arborescence
// -----------------------------------------------------------
// Remplace les caractères interdits Windows par "_"
function sanitizeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || '_';
}

// Reconstitue le chemin relatif du dossier en remontant les parents via Supabase
async function folderRelPath(sbClient, folderId) {
  if (!folderId) return '';
  const parts = [];
  let id = folderId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const { data, error } = await sbClient
      .from('folders').select('name, parent_id').eq('id', id).single();
    if (error || !data) break;
    parts.unshift(sanitizeName(data.name));
    id = data.parent_id;
  }
  return parts.join(path.sep);
}

// Si "dir/name" existe déjà, retourne "dir/name (1)" puis (2), etc.
function uniqueFilename(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let i = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${i})${ext}`;
    i++;
  }
  return candidate;
}

// -----------------------------------------------------------
// Config Multer (upload) — stockage temporaire, sera déplacé après
// -----------------------------------------------------------
const TMP_DIR = path.join(FILES_DIR, '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: Number(MAX_FILE_MB) * 1024 * 1024 }
});

// -----------------------------------------------------------
// Routes
// -----------------------------------------------------------

// Santé (non authentifié, pour vérifier que le serveur répond)
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Upload : multipart/form-data avec champs "file" et "folder_id"
app.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  const { folder_id } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });

  try {
    // 1) Reconstruire le chemin physique qui reflète l'arborescence de l'app
    const subPath = folder_id ? await folderRelPath(req.sb, folder_id) : '';
    const targetDir = path.join(FILES_DIR, subPath);
    fs.mkdirSync(targetDir, { recursive: true });

    // 2) Choisir un nom propre (avec gestion des doublons)
    const finalName = uniqueFilename(targetDir, sanitizeName(file.originalname));
    const finalAbs = path.join(targetDir, finalName);

    // 3) Déplacer depuis le dossier temporaire
    fs.renameSync(file.path, finalAbs);

    // 4) Chemin relatif stocké en DB (POSIX style pour portabilité)
    const relDisk = path.join(subPath, finalName).split(path.sep).join('/');

    const { data, error } = await req.sb.from('files').insert({
      folder_id: folder_id || null,
      name: file.originalname,
      disk_filename: relDisk,
      size_bytes: file.size,
      mime_type: file.mimetype,
      uploaded_by: req.user.id
    }).select().single();

    if (error) {
      fs.unlink(finalAbs, () => {});
      return res.status(400).json({ error: error.message });
    }
    res.json({ file: data });
  } catch (err) {
    // Nettoyer le fichier temporaire
    if (file?.path) fs.unlink(file.path, () => {});
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Résout le chemin absolu d'un fichier (compatible ancien stockage à plat et nouveau stockage hiérarchique)
function resolveFilePath(diskFilename) {
  // disk_filename est stocké en style POSIX ("dossier/sous/fichier.ext")
  const normalized = diskFilename.split('/').join(path.sep);
  return path.join(FILES_DIR, normalized);
}

// Download : stream du fichier
app.get('/download/:fileId', requireAuth, async (req, res) => {
  const { data: fileRow, error } = await req.sb
    .from('files').select('*').eq('id', req.params.fileId).single();
  if (error || !fileRow) return res.status(404).json({ error: 'File not found' });

  const full = resolveFilePath(fileRow.disk_filename);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'File missing on disk' });

  res.setHeader('Content-Type', fileRow.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileRow.name)}"`);
  fs.createReadStream(full).pipe(res);
});

// Stream (affichage inline, pour images)
app.get('/stream/:fileId', requireAuth, async (req, res) => {
  const { data: fileRow, error } = await req.sb
    .from('files').select('*').eq('id', req.params.fileId).single();
  if (error || !fileRow) return res.status(404).json({ error: 'File not found' });

  const full = resolveFilePath(fileRow.disk_filename);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'File missing on disk' });

  res.setHeader('Content-Type', fileRow.mime_type || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
});

// Suppression : supprime la ligne Supabase + le fichier disque
app.delete('/file/:fileId', requireAuth, async (req, res) => {
  const { data: fileRow, error: selErr } = await req.sb
    .from('files').select('*').eq('id', req.params.fileId).single();
  if (selErr || !fileRow) return res.status(404).json({ error: 'File not found' });

  // La RLS valide que l'utilisateur a le droit de supprimer
  const { error: delErr } = await req.sb.from('files').delete().eq('id', req.params.fileId);
  if (delErr) return res.status(403).json({ error: delErr.message });

  fs.unlink(resolveFilePath(fileRow.disk_filename), () => {});
  res.json({ ok: true });
});

// Récupère récursivement tous les IDs descendants d'un dossier (incluant lui-même)
async function getFolderDescendants(sbClient, rootId) {
  const all = [rootId];
  let queue = [rootId];
  const seen = new Set([rootId]);
  while (queue.length) {
    const { data, error } = await sbClient
      .from('folders').select('id').in('parent_id', queue);
    if (error) throw error;
    queue = (data || []).map(r => r.id).filter(id => !seen.has(id));
    queue.forEach(id => seen.add(id));
    all.push(...queue);
  }
  return all;
}

// Suppression d'un dossier : nettoie aussi les fichiers physiques et le dossier sur disque
app.delete('/folder/:folderId', requireAuth, async (req, res) => {
  try {
    const folderId = req.params.folderId;

    // 1) Calculer le chemin physique du dossier AVANT de le supprimer en DB
    const subPath = await folderRelPath(req.sb, folderId);

    // 2) Récupérer tous les fichiers du dossier et sous-dossiers (pour supprimer les fichiers anciens "à plat" qui ne sont pas dans subPath)
    const allFolderIds = await getFolderDescendants(req.sb, folderId);
    const { data: files } = await req.sb
      .from('files').select('disk_filename').in('folder_id', allFolderIds);

    // 3) Supprimer en DB (cascade supprime sous-dossiers et files automatiquement)
    const { error: delErr } = await req.sb.from('folders').delete().eq('id', folderId);
    if (delErr) return res.status(403).json({ error: delErr.message });

    // 4) Supprimer les fichiers physiques (chacun)
    for (const f of (files || [])) {
      try { fs.unlinkSync(resolveFilePath(f.disk_filename)); } catch {}
    }

    // 5) Supprimer le dossier physique si vide ou avec contenu résiduel
    if (subPath) {
      const fullPath = path.join(FILES_DIR, subPath);
      try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch (e) {
        console.warn('Impossible de supprimer le dossier physique:', fullPath, e.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Folder delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------
// Déplacement fichier ou dossier
// -----------------------------------------------------------
app.post('/move', requireAuth, async (req, res) => {
  const { type, id, target_folder_id } = req.body || {};
  if (!type || !id) return res.status(400).json({ error: 'type et id requis' });
  const newParentId = target_folder_id || null;

  try {
    if (type === 'file') {
      const { data: file, error: fErr } = await req.sb.from('files').select('*').eq('id', id).maybeSingle();
      if (fErr || !file) return res.status(404).json({ error: 'Fichier introuvable' });

      // Si déjà dans le dossier cible, no-op
      if ((file.folder_id || null) === newParentId) return res.json({ ok: true, noop: true });

      const newSubPath = newParentId ? await folderRelPath(req.sb, newParentId) : '';
      const newDir = path.join(FILES_DIR, newSubPath);
      fs.mkdirSync(newDir, { recursive: true });

      const baseName = path.basename(file.disk_filename);
      const finalName = uniqueFilename(newDir, baseName);
      const newAbs = path.join(newDir, finalName);
      const oldAbs = resolveFilePath(file.disk_filename);

      // Si le fichier n'existe pas sur le disque, refuser le move (évite de créer un orphelin DB)
      if (!fs.existsSync(oldAbs)) {
        return res.status(410).json({ error: 'Fichier absent sur le disque (orphelin). Supprime-le et ré-upload.' });
      }

      // Déplacer sur le disque
      let moved = false;
      try {
        fs.renameSync(oldAbs, newAbs);
        moved = true;
      } catch (e) {
        try {
          fs.copyFileSync(oldAbs, newAbs);
          fs.unlinkSync(oldAbs);
          moved = true;
        } catch (e2) {
          return res.status(500).json({ error: 'Échec déplacement disque : ' + e2.message });
        }
      }

      const newRel = path.join(newSubPath, finalName).split(path.sep).join('/');
      const { error: uErr } = await req.sb.from('files').update({
        folder_id: newParentId,
        disk_filename: newRel
      }).eq('id', id);
      if (uErr) {
        // Rollback disque
        if (moved) { try { fs.renameSync(newAbs, oldAbs); } catch {} }
        return res.status(500).json({ error: uErr.message });
      }
      return res.json({ ok: true });
    }

    if (type === 'folder') {
      // Validations : pas dans soi-même ou un descendant
      if (newParentId === id) return res.status(400).json({ error: 'Un dossier ne peut pas se contenir lui-même' });
      const descendants = await getFolderDescendants(req.sb, id);
      if (newParentId && descendants.includes(newParentId)) {
        return res.status(400).json({ error: 'Impossible de déplacer un dossier dans son propre sous-dossier' });
      }

      const { data: folder, error: gErr } = await req.sb.from('folders').select('*').eq('id', id).maybeSingle();
      if (gErr || !folder) return res.status(404).json({ error: 'Dossier introuvable' });
      if ((folder.parent_id || null) === newParentId) return res.json({ ok: true, noop: true });

      const oldSubPath = await folderRelPath(req.sb, id);
      const oldAbs = path.join(FILES_DIR, oldSubPath);
      const newParentSubPath = newParentId ? await folderRelPath(req.sb, newParentId) : '';
      const newSubPath = path.join(newParentSubPath, sanitizeName(folder.name));
      const newAbs = path.join(FILES_DIR, newSubPath);

      fs.mkdirSync(path.dirname(newAbs) || FILES_DIR, { recursive: true });
      if (fs.existsSync(newAbs)) {
        return res.status(409).json({ error: 'Un dossier du même nom existe déjà à la destination' });
      }

      let movedOnDisk = false;
      if (fs.existsSync(oldAbs)) {
        try {
          fs.renameSync(oldAbs, newAbs);
          movedOnDisk = true;
        } catch (e) {
          return res.status(500).json({ error: 'Échec déplacement disque : ' + e.message });
        }
      }

      // Maj DB : parent_id du dossier
      const { error: uErr } = await req.sb.from('folders').update({ parent_id: newParentId }).eq('id', id);
      if (uErr) {
        if (movedOnDisk) { try { fs.renameSync(newAbs, oldAbs); } catch {} }
        return res.status(500).json({ error: uErr.message });
      }

      // Maj disk_filename de tous les fichiers descendants
      const oldPrefix = oldSubPath.split(path.sep).join('/');
      const newPrefix = newSubPath.split(path.sep).join('/');
      const allIds = [id, ...descendants];
      const { data: descFiles } = await req.sb.from('files').select('id, disk_filename').in('folder_id', allIds);
      for (const f of (descFiles || [])) {
        if (!f.disk_filename) continue;
        const newDisk = f.disk_filename.startsWith(oldPrefix)
          ? newPrefix + f.disk_filename.slice(oldPrefix.length)
          : f.disk_filename;
        if (newDisk !== f.disk_filename) {
          await req.sb.from('files').update({ disk_filename: newDisk }).eq('id', f.id);
        }
      }
      return res.json({ ok: true, files_updated: descFiles?.length || 0 });
    }

    return res.status(400).json({ error: 'type invalide (file ou folder)' });
  } catch (err) {
    console.error('Move error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------
// Maintenance : détection et nettoyage des fichiers orphelins
// (entrées DB qui n'ont plus de fichier physique sur le disque)
// -----------------------------------------------------------
app.get('/admin/orphans', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.userRole !== 'admin') {
    // Vérifier le rôle via la table profiles
    const { data: prof } = await req.sb.from('profiles').select('role').eq('id', req.user.id).single();
    if (prof?.role !== 'admin') return res.status(403).json({ error: 'Admin uniquement' });
  }
  const { data: files } = await req.sb.from('files').select('id, name, disk_filename, folder_id, size_bytes');
  const orphans = (files || []).filter(f => {
    if (!f.disk_filename) return true;
    return !fs.existsSync(resolveFilePath(f.disk_filename));
  });
  res.json({ total: files?.length || 0, orphans, count: orphans.length });
});

app.post('/admin/orphans/cleanup', requireAuth, async (req, res) => {
  const { data: prof } = await req.sb.from('profiles').select('role').eq('id', req.user.id).single();
  if (prof?.role !== 'admin') return res.status(403).json({ error: 'Admin uniquement' });

  const { data: files } = await req.sb.from('files').select('id, disk_filename');
  const orphanIds = (files || [])
    .filter(f => !f.disk_filename || !fs.existsSync(resolveFilePath(f.disk_filename)))
    .map(f => f.id);
  if (orphanIds.length === 0) return res.json({ deleted: 0 });

  const { error } = await req.sb.from('files').delete().in('id', orphanIds);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: orphanIds.length, ids: orphanIds });
});

// -----------------------------------------------------------
// Web Push — endpoints
// -----------------------------------------------------------
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@guindoconstruction.xyz';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log('🔔 Web Push activé');
} else {
  console.log('⚠️  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY absentes — Web Push désactivé');
}

// Public : récupérer la clé publique VAPID (pas besoin d'auth pour ça)
app.get('/push/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC) return res.status(503).json({ error: 'Push non configuré' });
  res.json({ key: VAPID_PUBLIC });
});

// Enregistre une subscription pour l'utilisateur courant
app.post('/push/subscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'subscription invalide' });
    }
    const userAgent = req.headers['user-agent'] || null;
    const { error } = await req.sb.from('push_subscriptions').upsert({
      user_id: req.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: userAgent,
      last_used_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Désinscrit une subscription
app.post('/push/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint manquant' });
    await req.sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------
// Démarrage
// -----------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ Serveur GCBTP démarré sur http://localhost:${PORT}`);
  console.log(`   Max upload : ${MAX_FILE_MB} Mo`);
  console.log(`   CORS origin : ${CORS_ORIGIN}`);

  // Démarrer le module de notifications email
  startNotifier({
    supabaseUrl: SUPABASE_URL,
    serviceKey:  process.env.SUPABASE_SERVICE_ROLE_KEY,
    resendKey:   process.env.RESEND_API_KEY,
    fromEmail:   process.env.MAIL_FROM,
    siteUrl:     process.env.SITE_URL || 'https://www.guindoconstruction.xyz/equipe/'
  });
});
