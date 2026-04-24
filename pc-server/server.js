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
// Config Multer (upload) — stockage direct sur disque
// -----------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FILES_DIR),
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

  // Insérer les métadonnées dans Supabase
  const { data, error } = await req.sb.from('files').insert({
    folder_id: folder_id || null,
    name: file.originalname,
    disk_filename: file.filename,
    size_bytes: file.size,
    mime_type: file.mimetype,
    uploaded_by: req.user.id
  }).select().single();

  if (error) {
    // Si insert rate, supprimer le fichier orphelin
    fs.unlink(path.join(FILES_DIR, file.filename), () => {});
    return res.status(400).json({ error: error.message });
  }
  res.json({ file: data });
});

// Download : stream du fichier
app.get('/download/:fileId', requireAuth, async (req, res) => {
  const { data: fileRow, error } = await req.sb
    .from('files').select('*').eq('id', req.params.fileId).single();
  if (error || !fileRow) return res.status(404).json({ error: 'File not found' });

  const full = path.join(FILES_DIR, fileRow.disk_filename);
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

  const full = path.join(FILES_DIR, fileRow.disk_filename);
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

  fs.unlink(path.join(FILES_DIR, fileRow.disk_filename), () => {});
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
