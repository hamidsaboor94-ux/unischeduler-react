const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { all, get, run, logAudit, DB_PATH } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { getGradingScale } = require('../gradingScale');
const { runOrFriendlyError } = require('./crudRouter');

const router = express.Router();

// Lives next to the database file, same rationale as MATERIALS_DIR in materials.js.
const STUDENT_DOCS_DIR = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'student-documents');
const docFile = (id) => path.join(STUDENT_DOCS_DIR, String(id));
const ALLOWED_DOC_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ADMISSION_STATUSES = new Set(['Approved', 'Pending', 'Rejected']);
const ENROLLMENT_STATUSES = new Set(['Regular', 'Part-time', 'Probation', 'Withdrawn']);
const NUMERIC_FIELDS = new Set(['entryTestMarks', 'advisorTeacherId', 'departmentId', 'programSemester', 'previousGraduationYear']);
// Every column on student_profiles other than the primary key/timestamp — the admin edit whitelist.
const ADMIN_FIELDS = [
  'fatherName', 'grandfatherName', 'gender', 'dateOfBirth', 'nationality', 'nationalId', 'passportNumber',
  'presentAddress', 'permanentAddress', 'mobileNumber', 'emergencyContact',
  'entryTestMarks', 'sponsor', 'specialization', 'advisorTeacherId', 'departmentId',
  'programSemester', 'section', 'admissionStatus', 'enrollmentStatus',
  'previousSchoolName', 'previousGraduationYear',
];
// What a student may edit about themselves — everything else on the profile is admin-only.
const SELF_FIELDS = ['mobileNumber', 'emergencyContact'];

function canAccess(req, studentId) {
  return req.user.role === 'admin' || Number(req.user.sub) === Number(studentId);
}

async function ensureProfileRow(studentId) {
  await run('INSERT OR IGNORE INTO student_profiles (studentId) VALUES (?)', [studentId]);
}

/** Credit-weighted cumulative GPA + total credits completed, resolved live against whichever
    grading scale is current right now — same "never stale" approach already used for letter
    grades (see gradingScale.js's recomputeFinalGrade). Only counts currently-enrolled rows with
    a completed (non-null) letter grade. */
async function computeAcademicSummary(studentId) {
  const rows = await all(
    `SELECT e.grade, c.credits FROM enrollments e JOIN courses c ON c.id = e.courseId WHERE e.studentId = ? AND e.status = 'enrolled'`,
    [studentId]
  );
  const scale = await getGradingScale();
  let qualityPoints = 0, gpaCredits = 0, completedCredits = 0;
  for (const r of rows) {
    const credits = r.credits || 0;
    if (r.grade) {
      completedCredits += credits;
      const band = scale.find(b => b.label === r.grade);
      qualityPoints += (band?.point ?? 0) * credits;
      gpaCredits += credits;
    }
  }
  return {
    gpa: gpaCredits > 0 ? Math.round((qualityPoints / gpaCredits) * 100) / 100 : null,
    completedCredits,
  };
}

function validateAdminFields(body) {
  if (body.admissionStatus !== undefined && body.admissionStatus !== null && !ADMISSION_STATUSES.has(body.admissionStatus)) {
    return `admissionStatus must be one of: ${[...ADMISSION_STATUSES].join(', ')}`;
  }
  if (body.enrollmentStatus !== undefined && body.enrollmentStatus !== null && !ENROLLMENT_STATUSES.has(body.enrollmentStatus)) {
    return `enrollmentStatus must be one of: ${[...ENROLLMENT_STATUSES].join(', ')}`;
  }
  for (const f of NUMERIC_FIELDS) {
    if (body[f] !== undefined && body[f] !== null && (typeof body[f] !== 'number' || Number.isNaN(body[f]))) {
      return `${f} must be a number`;
    }
  }
  return null;
}

router.get('/:studentId', requireAuth, asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!canAccess(req, studentId)) return res.status(403).json({ error: 'Forbidden' });
  const student = await get(`SELECT id, name, email, idNumber, createdAt FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  await ensureProfileRow(studentId);
  const profile = await get('SELECT * FROM student_profiles WHERE studentId = ?', [studentId]);
  const department = profile.departmentId ? await get('SELECT id, name FROM departments WHERE id = ?', [profile.departmentId]) : null;
  const advisor = profile.advisorTeacherId ? await get('SELECT id, name FROM teachers WHERE id = ?', [profile.advisorTeacherId]) : null;
  const activeTerm = await get('SELECT id, name FROM terms WHERE isActive = 1');
  const summary = await computeAcademicSummary(studentId);
  const requiredCreditsRow = await get(`SELECT value FROM settings WHERE key = 'requiredCreditsForGraduation'`);
  const requiredCredits = requiredCreditsRow?.value ? Number(requiredCreditsRow.value) : null;
  const documents = await all(
    'SELECT id, documentType, title, fileName, mimeType, createdAt FROM student_documents WHERE studentId = ? ORDER BY createdAt DESC',
    [studentId]
  );

  res.json({ student, profile, department, advisor, activeTerm, ...summary, requiredCredits, documents });
}));

router.put('/me', requireAuth, requireRole('student'), asyncHandler(async (req, res) => {
  await ensureProfileRow(req.user.sub);
  const cols = SELF_FIELDS.filter(f => req.body[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  await run(
    `UPDATE student_profiles SET ${cols.map(c => `${c} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE studentId = ?`,
    [...cols.map(c => req.body[c]), req.user.sub]
  );
  await logAudit(req.user, 'update-profile', 'student_profiles', req.user.sub, req.body);
  res.json(await get('SELECT * FROM student_profiles WHERE studentId = ?', [req.user.sub]));
}));

router.put('/:studentId', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  const student = await get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const cols = ADMIN_FIELDS.filter(f => req.body[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  const validationError = validateAdminFields(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  await ensureProfileRow(studentId);
  const result = await runOrFriendlyError(res, 'student_profiles', () => run(
    `UPDATE student_profiles SET ${cols.map(c => `${c} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE studentId = ?`,
    [...cols.map(c => req.body[c]), studentId]
  ));
  if (result === undefined) return; // response already sent by runOrFriendlyError

  await logAudit(req.user, 'update', 'student_profiles', studentId, req.body);
  res.json(await get('SELECT * FROM student_profiles WHERE studentId = ?', [studentId]));
}));

router.post('/:studentId/documents', requireAuth, requireRole('admin'), upload.single('file'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  const { documentType, title } = req.body;
  if (!String(documentType || '').trim() || !String(title || '').trim()) {
    return res.status(400).json({ error: 'documentType and title are required' });
  }
  if (!req.file) return res.status(400).json({ error: 'A file is required' });
  if (!ALLOWED_DOC_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'That file type is not supported.' });
  if (!STUDENT_DOCS_DIR) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });

  const student = await get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const result = await run(
    'INSERT INTO student_documents (studentId, documentType, title, fileName, mimeType, uploadedBy) VALUES (?, ?, ?, ?, ?, ?)',
    [studentId, documentType.trim(), title.trim(), req.file.originalname, req.file.mimetype, req.user.sub]
  );
  fs.mkdirSync(STUDENT_DOCS_DIR, { recursive: true });
  fs.writeFileSync(docFile(result.id), req.file.buffer);
  await logAudit(req.user, 'upload-document', 'student_documents', result.id, { studentId, documentType: documentType.trim(), title: title.trim() });

  res.status(201).json(await get('SELECT id, documentType, title, fileName, mimeType, createdAt FROM student_documents WHERE id = ?', [result.id]));
}));

router.get('/documents/:id/file', requireAuth, asyncHandler(async (req, res) => {
  const doc = await get('SELECT * FROM student_documents WHERE id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canAccess(req, doc.studentId)) return res.status(403).json({ error: 'Forbidden' });
  if (!STUDENT_DOCS_DIR || !fs.existsSync(docFile(doc.id))) return res.status(404).json({ error: 'File not found' });
  res.download(docFile(doc.id), doc.fileName);
}));

router.delete('/documents/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const doc = await get('SELECT * FROM student_documents WHERE id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  await run('DELETE FROM student_documents WHERE id = ?', [req.params.id]);
  if (STUDENT_DOCS_DIR) { try { fs.unlinkSync(docFile(doc.id)); } catch { /* already gone */ } }
  await logAudit(req.user, 'delete-document', 'student_documents', req.params.id, { studentId: doc.studentId, title: doc.title });
  res.status(204).end();
}));

module.exports = router;
