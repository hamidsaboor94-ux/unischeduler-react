const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { backupTo, restoreFrom, logAudit, DB_PATH } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });

// Every SQLite database file starts with these exact 16 bytes.
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** A unique temp path for `name` — its own mkdtemp directory, so concurrent
    exports can't collide and cleanup can just remove the whole directory. */
function tempFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unischeduler-')), name);
}

function cleanup(file) {
  try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch { /* best effort — it's a temp dir */ }
}

// GET /api/backup/export — downloads a consistent snapshot of the whole database.
router.get('/export', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if (DB_PATH === ':memory:') return res.status(400).json({ error: 'In-memory database cannot be exported' });
  const stamp = new Date().toISOString().slice(0, 10);
  const snapshot = tempFile(`unischeduler-backup-${stamp}.sqlite`);
  await backupTo(snapshot);
  await logAudit(req.user, 'export', 'backup', null, { file: path.basename(snapshot) });
  res.download(snapshot, path.basename(snapshot), () => cleanup(snapshot));
}));

// POST /api/backup/restore — replaces the live database with an uploaded backup.
// The frontend shows the "this overwrites everything" warning before calling this;
// here we verify the file really is a healthy UniScheduler database before swapping,
// so a mis-picked file can never destroy the current data.
router.post('/restore', requireAuth, requireRole('admin'), upload.single('backup'), asyncHandler(async (req, res) => {
  if (DB_PATH === ':memory:') return res.status(400).json({ error: 'In-memory database cannot be restored' });
  if (!req.file) return res.status(400).json({ error: 'No backup file uploaded' });
  if (req.file.buffer.length < 100 || !req.file.buffer.subarray(0, 16).equals(SQLITE_MAGIC)) {
    return res.status(400).json({ error: 'That file is not a SQLite database — choose a backup exported from UniScheduler.' });
  }

  const uploaded = tempFile('uploaded-backup.sqlite');
  fs.writeFileSync(uploaded, req.file.buffer);
  try {
    let integrity, hasUsersTable;
    try {
      const candidate = new DatabaseSync(uploaded, { readOnly: true });
      try {
        integrity = candidate.prepare('PRAGMA integrity_check').get();
        hasUsersTable = !!candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
      } finally {
        candidate.close();
      }
    } catch {
      return res.status(400).json({ error: 'Could not read that file as a SQLite database.' });
    }
    if (!integrity || integrity.integrity_check !== 'ok') {
      return res.status(400).json({ error: 'The backup file is corrupted (failed SQLite integrity check).' });
    }
    if (!hasUsersTable) {
      return res.status(400).json({ error: 'That database is not a UniScheduler backup (no users table).' });
    }

    await restoreFrom(uploaded);
    // This lands in the *restored* database's audit log — exactly where you'd
    // want the "data was replaced from a backup on <date>" record to live.
    await logAudit(req.user, 'restore', 'backup', null, { fileName: req.file.originalname, sizeBytes: req.file.buffer.length });
    res.json({ ok: true });
  } finally {
    cleanup(uploaded);
  }
}));

module.exports = router;
