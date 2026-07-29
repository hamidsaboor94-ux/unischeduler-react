/**
 * Faculty file storage — disk-backed today, kept behind this one module so a later switch to
 * cloud storage (S3, Azure Blob, etc.) only means reimplementing the four functions below, not
 * touching routes/teacherProfile.js. Bytes never touch the database; only the relative path this
 * module hands back is stored in teacher_profiles/teacher_education/teacher_documents.
 *
 * Layout: <next to the DB file>/uploads/faculty/<teacherId>/<category>-<row id>.<ext> — never the
 * caller's original filename (that's stored separately as metadata), so a hostile filename can't
 * escape the teacher's own folder.
 */
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./db');

const FACULTY_ROOT = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'uploads', 'faculty');

const EXT_FOR_MIME = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

function extFor(mimeType) {
  return EXT_FOR_MIME[mimeType] || '';
}

/** Relative path (stored in the DB) for a given teacher/category/row id — deterministic, never
    derived from user input. */
function relativePath(teacherId, category, id, mimeType) {
  return path.join(String(teacherId), `${category}-${id}${extFor(mimeType)}`);
}

/** Writes `buffer` to disk under teacherId's folder and returns the relative path to store. */
function saveFile(teacherId, category, id, mimeType, buffer) {
  if (!FACULTY_ROOT) throw new Error('Cannot store a file for an in-memory database');
  const rel = relativePath(teacherId, category, id, mimeType);
  const full = path.join(FACULTY_ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return rel;
}

function absolutePath(relPath) {
  return FACULTY_ROOT ? path.join(FACULTY_ROOT, relPath) : null;
}

function fileExists(relPath) {
  const full = absolutePath(relPath);
  return !!full && fs.existsSync(full);
}

function deleteFile(relPath) {
  const full = absolutePath(relPath);
  if (!full) return;
  try { fs.unlinkSync(full); } catch { /* already gone */ }
}

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

module.exports = { FACULTY_ROOT, saveFile, absolutePath, fileExists, deleteFile, ALLOWED_MIME_TYPES };
