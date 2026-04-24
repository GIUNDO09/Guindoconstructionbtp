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
app.use(cors({ origin: CORS_ORIGIN.split(',').map(s => s.trim()) }));
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

// -----------------------------------------------------------
// Démarrage
// -----------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ Serveur GCBTP démarré sur http://localhost:${PORT}`);
  console.log(`   Max upload : ${MAX_FILE_MB} Mo`);
  console.log(`   CORS origin : ${CORS_ORIGIN}`);
  console.log('');
  console.log('👉 Maintenant lance le tunnel Cloudflare dans une autre fenêtre :');
  console.log(`   cloudflared tunnel --url http://localhost:${PORT}`);
});
