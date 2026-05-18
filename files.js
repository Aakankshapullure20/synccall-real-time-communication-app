/**
 * SyncCall — File Upload/Download Routes
 * POST /files/upload   — store encrypted blob
 * GET  /files/:fileId  — retrieve encrypted blob
 *
 * Files are already encrypted by the client.
 * Server stores raw bytes — never sees plaintext.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('./auth');

const router = express.Router();

// Store uploads in /uploads folder
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Use the file's original name (which is the file ID set by the client)
    cb(null, file.originalname + '.enc');
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
});

// ── Upload (protected) ──────────────────────────────────────────────────
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileId = req.file.filename.replace('.enc', '');
  console.log(`[upload] ${req.user.name} uploaded ${fileId} (${req.file.size} bytes encrypted)`);
  res.json({ fileId, size: req.file.size });
});

// ── Download (protected) ────────────────────────────────────────────────
router.get('/:fileId', requireAuth, (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.fileId + '.enc');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(filePath);
});

// ── Socket.io file metadata broadcast ──────────────────────────────────
// Add this handler inside your io.on('connection') block in server.js:
//
//   socket.on('share-file', ({ roomId, meta }) => {
//     socket.to(roomId).emit('file-shared', meta);
//   });

module.exports = router;