/**
 * Student photo storage — disk-backed, same rationale and shape as facultyStorage.js: kept behind
 * this one module so bytes never touch the database, only the relative path this module hands
 * back is stored in student_profiles.photoPath.
 *
 * Layout: <next to the DB file>/uploads/students/<studentId>/photo-<studentId>.<ext> — never the
 * caller's original filename, so a hostile filename can't escape the student's own folder.
 */
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./db');

const STUDENT_ROOT = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'uploads', 'students');

const EXT_FOR_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

function extFor(mimeType) {
  return EXT_FOR_MIME[mimeType] || '';
}

function relativePath(studentId, category, id, mimeType) {
  return path.join(String(studentId), `${category}-${id}${extFor(mimeType)}`);
}

function saveFile(studentId, category, id, mimeType, buffer) {
  if (!STUDENT_ROOT) throw new Error('Cannot store a file for an in-memory database');
  const rel = relativePath(studentId, category, id, mimeType);
  const full = path.join(STUDENT_ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return rel;
}

function absolutePath(relPath) {
  return STUDENT_ROOT ? path.join(STUDENT_ROOT, relPath) : null;
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

module.exports = { STUDENT_ROOT, saveFile, absolutePath, fileExists, deleteFile };
