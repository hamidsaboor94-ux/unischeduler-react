/** Disk-backed storage for notice attachments — same pattern as course_materials
    (routes/materials.js): bytes live in a folder next to the database file, keyed by the
    attachment's own row id; the DB only ever holds metadata. */
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./db');

const ATTACHMENTS_DIR = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'notice_attachments');

const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'application/zip', 'image/png', 'image/jpeg',
]);

function attachmentFilePath(attachmentId) {
  return path.join(ATTACHMENTS_DIR, String(attachmentId));
}

function writeAttachment(attachmentId, buffer) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  fs.writeFileSync(attachmentFilePath(attachmentId), buffer);
}

function deleteAttachmentFile(attachmentId) {
  const filePath = attachmentFilePath(attachmentId);
  if (ATTACHMENTS_DIR && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function attachmentFileExists(attachmentId) {
  return !!ATTACHMENTS_DIR && fs.existsSync(attachmentFilePath(attachmentId));
}

module.exports = {
  ATTACHMENTS_DIR, ALLOWED_ATTACHMENT_TYPES,
  attachmentFilePath, writeAttachment, deleteAttachmentFile, attachmentFileExists,
};
