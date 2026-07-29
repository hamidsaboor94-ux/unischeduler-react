const express = require('express');
const fs = require('fs');
const path = require('path');
const { get, run, logAudit, backupTo, transaction, DB_PATH } = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Lives next to the database file itself, same as the branding logo directory — so backups
// stay with the data (and move with it if the data directory is ever relocated/backed up
// externally) rather than living under the app's source tree.
const BACKUPS_DIR = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'backups');

function backupTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Tables cleared by a system reset, in an order where every foreign key referencing an
// earlier table has already been emptied before that table's own rows go (FK enforcement is
// ON — see db.js — so the wrong order throws a constraint error instead of orphaning rows).
// `users` is handled separately below (only non-admin rows are removed).
//
// Deliberately NOT cleared: colleges/departments/rooms/programs (organizational & facility
// reference data, not day-to-day records), `settings` (institution/branding config,
// grading scale), and `audit_log` (history, including this reset's own entry).
const CLEAR_TABLES_IN_ORDER = [
  'assignment_submissions', 'attendance', 'slot_exceptions', 'course_activity_reads',
  'grade_scores', 'grade_items',
  'application_documents', 'student_documents',
  'announcements', 'course_materials', 'assignments',
  'payments', 'scholarships', 'enrollments',
  'exams', 'timetable_slots', 'course_offerings', 'course_prerequisites',
  'applications', 'student_profiles',
  'courses', 'teachers', 'terms',
  'notifications',
];

/** POST /api/super-admin/system-reset — wipes every operational record (courses, timetable,
    enrollments, students/teachers, exams, finance, admissions, notifications, ...) while
    preserving the schema, Super Admin accounts, organizational reference data, and
    institution/branding config. Mounted with requireAuth + requireRole('admin') in app.js —
    enforced there, not just hidden in the UI, so this can never run for any other role
    regardless of what the frontend shows. A confirmation phrase (the literal "RESET" or the
    configured institution name) is required and checked before anything else happens; a
    requested pre-reset backup is taken (and must succeed) before any DELETE runs, and the
    whole wipe is one transaction so a failure partway through leaves the database untouched. */
router.post('/system-reset', asyncHandler(async (req, res) => {
  const { confirmationPhrase, backupFirst } = req.body;
  const phrase = typeof confirmationPhrase === 'string' ? confirmationPhrase.trim() : '';
  if (!phrase) {
    return res.status(400).json({ error: 'A confirmation phrase is required to reset the system.' });
  }

  const orgNameRow = await get(`SELECT value FROM settings WHERE key = 'orgName'`);
  const orgName = (orgNameRow?.value || '').trim();
  const matches = phrase === 'RESET' || (!!orgName && phrase.toLowerCase() === orgName.toLowerCase());
  if (!matches) {
    return res.status(400).json({ error: 'Confirmation phrase does not match. Type RESET or the institution name exactly.' });
  }

  let backupFile = null;
  if (backupFirst) {
    if (DB_PATH === ':memory:' || !BACKUPS_DIR) {
      return res.status(400).json({ error: 'Cannot back up an in-memory database — reset aborted.' });
    }
    try {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      const name = `backup-${backupTimestamp()}.db`;
      await backupTo(path.join(BACKUPS_DIR, name));
      backupFile = name;
    } catch (err) {
      return res.status(500).json({ error: `Backup failed — reset aborted, no data was touched. (${err.message})` });
    }
  }

  const deletedCounts = {};
  await transaction(async () => {
    for (const table of CLEAR_TABLES_IN_ORDER) {
      const result = await run(`DELETE FROM ${table}`);
      deletedCounts[table] = result.changes;
    }
    const usersResult = await run(`DELETE FROM users WHERE role != 'admin'`);
    deletedCounts.users = usersResult.changes;
  });

  await logAudit(req.user, 'system-reset', 'system', null, { backupTaken: !!backupFirst, backupFile, deletedCounts });

  res.json({ ok: true, backupFile, deletedCounts });
}));

module.exports = router;
