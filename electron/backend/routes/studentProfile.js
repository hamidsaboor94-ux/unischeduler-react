const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { all, get, run, logAudit, DB_PATH } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { runOrFriendlyError } = require('./crudRouter');
const { teacherIdForUser } = require('../ownership');
const { computeAcademicSummary } = require('../academicSummary');
const { ensureOpenRecord, resolveRequiredCredits } = require('../academicProgression');
const { can } = require('../permissions');
const { isScopedRequest, departmentInScope } = require('../scope');
const studentStorage = require('../studentStorage');
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = express.Router();

// Lives next to the database file, same rationale as MATERIALS_DIR in materials.js.
const STUDENT_DOCS_DIR = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'student-documents');
const docFile = (id) => path.join(STUDENT_DOCS_DIR, String(id));
const ALLOWED_DOC_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ADMISSION_STATUSES = new Set(['Approved', 'Pending', 'Rejected']);
const ENROLLMENT_STATUSES = new Set(['Regular', 'Part-time', 'Probation', 'Withdrawn']);
const STUDENT_STATUSES = new Set(['Active', 'Graduated', 'Suspended', 'Withdrawn', 'On Leave']);
const NUMERIC_FIELDS = new Set(['entryTestMarks', 'advisorTeacherId', 'departmentId', 'programId', 'studentTypeId', 'previousGraduationYear']);
// Every column on student_profiles other than the primary key/timestamp — the admin edit whitelist.
// Deliberately excludes programSemester/semesterStatus — those are driven by the automatic
// progression engine (academicProgression.js) and its audited manual-override endpoint
// (routes/progression.js), not a free-text field edit, per the semester-progression feature's
// "every manual override must be recorded with a reason" requirement.
const ADMIN_FIELDS = [
  'fatherName', 'grandfatherName', 'gender', 'dateOfBirth', 'nationality', 'nationalId', 'passportNumber',
  'presentAddress', 'permanentAddress', 'mobileNumber', 'emergencyContact',
  'entryTestMarks', 'sponsor', 'specialization', 'advisorTeacherId', 'departmentId', 'programId', 'studentTypeId',
  'section', 'batch', 'admissionStatus', 'enrollmentStatus', 'studentStatus',
  'previousSchoolName', 'previousGraduationYear',
];
// What a student may edit about themselves — everything else on the profile is admin-only.
const SELF_FIELDS = ['mobileNumber', 'emergencyContact'];

/** Synchronous access for admin (any student) and a student themselves. */
function canAccess(req, studentId) {
  return req.user.role === 'admin' || Number(req.user.sub) === Number(studentId);
}

// Roles whose job is direct academic-record management and so need the full profile, including
// identity/location/emergency-contact fields. Everyone else who reaches this endpoint via the
// broader `students:read` grant (admissions_officer, bursar, viewer) gets the rest of the profile
// (name, program, enrollment status, academic summary) but not this sensitive PII.
const FULL_DETAIL_ROLES = new Set(['registrar', 'records_officer', 'dean', 'dept_head']);
const SENSITIVE_PII_FIELDS = ['nationalId', 'passportNumber', 'dateOfBirth', 'presentAddress', 'permanentAddress', 'emergencyContact'];

function redactSensitiveProfile(profile, req, studentId) {
  if (canAccess(req, studentId) || req.user.role === 'advisor' || FULL_DETAIL_ROLES.has(req.user.role)) return profile;
  const redacted = { ...profile };
  for (const f of SENSITIVE_PII_FIELDS) redacted[f] = null;
  return redacted;
}

/** Full access check: admin/self (canAccess), a Student Advisor for their own advisees
    (student_profiles.advisorTeacherId → the teacher record linked to this user), or any role
    the central `students` module policy grants read access to (registrar, records_officer,
    admissions_officer, dean, dept_head, bursar, viewer — see permissions.js POLICY.students) —
    the same policy students.js's GET /:id/overview already enforces, so this profile endpoint
    and that overview endpoint never disagree about who may view a given student. Department/
    college-scoped roles (dean/dept_head) are further confined to their own scope, same as
    students.js. */
async function canAccessAsync(req, studentId) {
  if (canAccess(req, studentId)) return true;
  if (req.user.role === 'advisor') {
    const teacherId = await teacherIdForUser(req.user.sub);
    if (teacherId == null) return false;
    const profile = await get('SELECT advisorTeacherId FROM student_profiles WHERE studentId = ?', [studentId]);
    return !!profile && Number(profile.advisorTeacherId) === Number(teacherId);
  }
  if (can(req.user.role, 'students', 'read')) {
    if (!isScopedRequest(req)) return true;
    const profile = await get('SELECT departmentId FROM student_profiles WHERE studentId = ?', [studentId]);
    return departmentInScope(req, profile?.departmentId);
  }
  return false;
}

async function ensureProfileRow(studentId) {
  await run('INSERT OR IGNORE INTO student_profiles (studentId) VALUES (?)', [studentId]);
}

function validateAdminFields(body) {
  if (body.admissionStatus !== undefined && body.admissionStatus !== null && !ADMISSION_STATUSES.has(body.admissionStatus)) {
    return `admissionStatus must be one of: ${[...ADMISSION_STATUSES].join(', ')}`;
  }
  if (body.enrollmentStatus !== undefined && body.enrollmentStatus !== null && !ENROLLMENT_STATUSES.has(body.enrollmentStatus)) {
    return `enrollmentStatus must be one of: ${[...ENROLLMENT_STATUSES].join(', ')}`;
  }
  if (body.studentStatus !== undefined && body.studentStatus !== null && !STUDENT_STATUSES.has(body.studentStatus)) {
    return `studentStatus must be one of: ${[...STUDENT_STATUSES].join(', ')}`;
  }
  // 'Graduated' requires the eligibility + financial-clearance checks that only
  // POST /api/graduation/confirm/:studentId performs — never settable through this free-text edit.
  if (body.studentStatus === 'Graduated') {
    return "studentStatus 'Graduated' cannot be set here — use POST /api/graduation/confirm/:studentId";
  }
  for (const f of NUMERIC_FIELDS) {
    if (body[f] !== undefined && body[f] !== null && (typeof body[f] !== 'number' || Number.isNaN(body[f]))) {
      return `${f} must be a number`;
    }
  }
  return null;
}

/** The students a Student Advisor advises — their advisee roster. Advisor-only;
    scoped entirely by the advisor's own linked teacher id, so it can never
    return a student they don't advise. */
router.get('/advisees', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== 'advisor') return res.status(403).json({ error: 'Forbidden' });
  const teacherId = await teacherIdForUser(req.user.sub);
  if (teacherId == null) return res.json([]);
  const rows = await all(
    `SELECT u.id as studentId, u.name, u.email, u.idNumber,
            sp.programSemester, sp.section, sp.enrollmentStatus,
            d.name as departmentName
     FROM student_profiles sp
     JOIN users u ON u.id = sp.studentId AND u.role = 'student'
     LEFT JOIN departments d ON d.id = sp.departmentId
     WHERE sp.advisorTeacherId = ? ORDER BY u.name`,
    [teacherId]
  );
  res.json(rows);
}));

router.get('/:studentId', requireAuth, asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!(await canAccessAsync(req, studentId))) return res.status(403).json({ error: 'Forbidden' });
  // No role filter — lets a role_mismatch row from the Students discovery scan (an account
  // whose role changed away from student) still load its historical profile read-only.
  const student = await get(`SELECT id, name, email, idNumber, role, createdAt FROM users WHERE id = ?`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  // Guarantees a semester_records row (and its programSemester/semesterStatus mirror onto
  // student_profiles) exists before reading the profile — "a new student starts in Semester 1"
  // must be true the first time anyone looks, not only after the first progression evaluation.
  // Only for role='student' — a role_mismatch row (see comment above) never gets one.
  if (student.role === 'student') await ensureOpenRecord(studentId);
  const profile = await get('SELECT * FROM student_profiles WHERE studentId = ?', [studentId]);
  const department = profile.departmentId ? await get('SELECT id, name FROM departments WHERE id = ?', [profile.departmentId]) : null;
  const program = profile.programId ? await get('SELECT id, name, totalCredits FROM programs WHERE id = ?', [profile.programId]) : null;
  const studentType = profile.studentTypeId ? await get('SELECT id, name FROM student_types WHERE id = ?', [profile.studentTypeId]) : null;
  const advisor = profile.advisorTeacherId ? await get('SELECT id, name FROM teachers WHERE id = ?', [profile.advisorTeacherId]) : null;
  const activeTerm = await get('SELECT id, name FROM terms WHERE isActive = 1');
  const summary = await computeAcademicSummary(studentId);
  const requiredCredits = await resolveRequiredCredits(program);
  const documents = await all(
    'SELECT id, documentType, title, fileName, mimeType, createdAt FROM student_documents WHERE studentId = ? ORDER BY createdAt DESC',
    [studentId]
  );
  const graduationRecord = await get(
    `SELECT id,graduateNumber,degreeAwarded,officialGraduationDate,recordStatus
     FROM graduation_records WHERE studentId=? AND finalizedAt IS NOT NULL ORDER BY id DESC LIMIT 1`,
    [studentId]
  );
  const responseProfile = redactSensitiveProfile(profile, req, studentId);

  res.json({ student, profile: responseProfile, department, program, studentType, advisor, activeTerm, ...summary, requiredCredits, documents, graduationRecord });
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

router.post('/:studentId/photo', requireAuth, requireRole('admin'), photoUpload.single('photo'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  const student = await get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (!req.file) return res.status(400).json({ error: 'A photo file is required' });
  if (req.file.mimetype !== 'image/png' && req.file.mimetype !== 'image/jpeg') {
    return res.status(400).json({ error: 'Photo must be a PNG or JPEG image.' });
  }
  if (!studentStorage.STUDENT_ROOT) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });
  await ensureProfileRow(studentId);
  const relPath = studentStorage.saveFile(studentId, 'photo', studentId, req.file.mimetype, req.file.buffer);
  await run('UPDATE student_profiles SET photoPath = ?, updatedAt = CURRENT_TIMESTAMP WHERE studentId = ?', [relPath, studentId]);
  await logAudit(req.user, 'upload-photo', 'student_profiles', studentId, null);
  res.json(await get('SELECT * FROM student_profiles WHERE studentId = ?', [studentId]));
}));

router.get('/:studentId/photo', requireAuth, asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!(await canAccessAsync(req, studentId))) return res.status(403).json({ error: 'Forbidden' });
  const profile = await get('SELECT photoPath FROM student_profiles WHERE studentId = ?', [studentId]);
  if (!profile?.photoPath || !studentStorage.fileExists(profile.photoPath)) return res.status(404).json({ error: 'No photo on file' });
  res.sendFile(studentStorage.absolutePath(profile.photoPath));
}));

module.exports = router;
