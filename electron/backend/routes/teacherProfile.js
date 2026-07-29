const express = require('express');
const multer = require('multer');
const { all, get, run, logAudit, nextEmployeeId } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission, hasPermission, getUserRoles } = require('../authz');
const { isScopedRequest, departmentInScope } = require('../scope');
const facultyStorage = require('../facultyStorage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadCertAndTranscript = upload.fields([{ name: 'file', maxCount: 1 }, { name: 'transcript', maxCount: 1 }]);

const DESIGNATIONS = new Set([
  'Lecturer', 'Assistant Professor', 'Associate Professor', 'Professor', 'Senior Lecturer',
  'Instructor', 'Teaching Assistant', 'Research Assistant', 'Visiting Professor',
  'Visiting Faculty', 'Adjunct Faculty', 'Other',
]);
const EMPLOYMENT_TYPES = new Set(['full-time', 'part-time', 'contract', 'visiting', 'adjunct']);
const STATUSES = new Set(['Active', 'On Leave', 'Suspended', 'Inactive', 'Resigned', 'Retired', 'Terminated']);
const DEGREES = new Set(["High School", "Diploma", "Bachelor's", "Master's", "MPhil", "PhD", "Postdoctoral", 'Other']);
const DOC_TYPES = new Set([
  'CV', 'certificate', 'National ID', 'Passport', 'Appointment Letter', 'Employment Contract',
  'Experience Certificate', 'Teaching Certificate', 'Professional License', 'Background Verification', 'other',
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Every teacher_profiles column an Admin/Dean/Department Head may set — the admin-style edit
// whitelist, same shape as ADMIN_FIELDS in routes/studentProfile.js. payrollId is deliberately
// excluded here and gated separately (see canSeePayroll) since it's sensitive financial data.
const PROFILE_FIELDS = [
  // Personal
  'gender', 'dateOfBirth', 'preferredName', 'fatherName', 'motherName', 'nationality', 'nationalId', 'maritalStatus',
  // Contact
  'phone', 'personalEmail', 'address', 'officialEmail', 'secondaryPhone',
  'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone',
  'permanentAddress', 'city', 'province', 'country', 'postalCode',
  // Employment
  'designation', 'employmentType', 'dateOfJoining', 'status',
  'contractStartDate', 'contractEndDate', 'officeRoom', 'reportingManagerId', 'employeeCategory', 'workLocation',
  // Teaching / academic profile
  'bio', 'qualifiedSubjects', 'expertiseAreas', 'researchInterests', 'teachingInterests', 'publications', 'awards', 'officeHours',
];
const PAYROLL_FIELD = 'payrollId';

/** Resolves { departmentId } for scopeOf — same courseScopeOf/teacherScopeOf shape used
    throughout authz.js callers, so a Dept Head/Dean 403s outside their own department. */
async function teacherScopeOf(req) {
  return get('SELECT departmentId FROM teachers WHERE id = ?', [req.params.teacherId]);
}
function relatedScopeOf(table) {
  return async (req) => get(
    `SELECT t.departmentId FROM ${table} x JOIN teachers t ON t.id = x.teacherId WHERE x.id = ?`, [req.params.id]
  );
}

/** True if the caller may view/edit sensitive payroll data — the same "finance write" gate
    bursar/admin already hold, rather than inventing a parallel HR-only permission. */
async function canSeePayroll(req) {
  const roles = await getUserRoles(req.user.sub, req.user.role);
  return hasPermission(roles, 'finance', 'Update');
}

/** How much of a teacher's HR profile the caller may see: 'full' (self, or a role with
    teachers:View in scope — registrar/dean/dept_head/viewer/admin), 'payroll' (Bursar — needs to
    read/set payrollId but has no business seeing personal PII or HR documents), or 'none'. */
async function teacherAccessLevel(req, teacherId) {
  const own = await get('SELECT id FROM teachers WHERE userId = ?', [req.user.sub]);
  if (own && own.id === Number(teacherId)) return 'full';
  const roles = await getUserRoles(req.user.sub, req.user.role);
  if (await hasPermission(roles, 'teachers', 'View')) {
    if (isScopedRequest(req)) {
      const scope = await teacherScopeOf({ params: { teacherId } });
      if (scope && scope.departmentId != null && !departmentInScope(req, scope.departmentId)) return 'none';
    }
    return 'full';
  }
  if (await hasPermission(roles, 'finance', 'Update')) return 'payroll';
  return 'none';
}

// Personal/identity PII stripped from a 'payroll'-level response — Bursar can still see/edit
// payrollId and employment fields relevant to pay, just not identity documents or contacts.
const TEACHER_PII_FIELDS = [
  'nationalId', 'dateOfBirth', 'address', 'personalEmail', 'phone', 'secondaryPhone',
  'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone',
];

/** Guards PUT /:teacherId. Normally identical to requirePermission('teachers.Update', {scopeOf:
    teacherScopeOf}) — but a request that touches ONLY payrollId is let through on finance write
    access instead, so a Bursar (finance:W, but no access to the teachers module at all) can still
    record a faculty member's payroll id without being granted general teacher-editing rights. Any
    request that mixes payrollId with other fields still needs full teachers.Update. */
async function requireProfileUpdateAccess(req, res, next) {
  const roles = await getUserRoles(req.user.sub, req.user.role);
  const bodyKeys = Object.keys(req.body || {});
  const onlyPayroll = bodyKeys.length > 0 && bodyKeys.every(k => k === PAYROLL_FIELD);

  if (onlyPayroll) {
    if (await hasPermission(roles, 'finance', 'Update')) return next();
    return res.status(403).json({ error: 'You do not have permission to edit payroll information.' });
  }
  if (!(await hasPermission(roles, 'teachers', 'Update'))) {
    return res.status(403).json({ error: 'You do not have permission to do this.', code: 'NO_PERMISSION', module: 'teachers', action: 'Update' });
  }
  if (isScopedRequest(req)) {
    const scope = await teacherScopeOf(req);
    if (scope && scope.departmentId != null && !departmentInScope(req, scope.departmentId)) {
      return res.status(403).json({ error: 'This is outside your department scope.', code: 'OUT_OF_SCOPE' });
    }
  }
  next();
}

async function ensureProfileRow(teacherId) {
  const existing = await get('SELECT teacherId, employeeId FROM teacher_profiles WHERE teacherId = ?', [teacherId]);
  if (existing) {
    if (!existing.employeeId) {
      await run('UPDATE teacher_profiles SET employeeId = ? WHERE teacherId = ?', [await nextEmployeeId(), teacherId]);
    }
    return;
  }
  await run('INSERT INTO teacher_profiles (teacherId, employeeId) VALUES (?, ?)', [teacherId, await nextEmployeeId()]);
}

function validateProfileFields(body) {
  if (body.designation !== undefined && body.designation !== null && !DESIGNATIONS.has(body.designation)) {
    return `designation must be one of: ${[...DESIGNATIONS].join(', ')}`;
  }
  if (body.employmentType !== undefined && body.employmentType !== null && !EMPLOYMENT_TYPES.has(body.employmentType)) {
    return `employmentType must be one of: ${[...EMPLOYMENT_TYPES].join(', ')}`;
  }
  if (body.status !== undefined && body.status !== null && !STATUSES.has(body.status)) {
    return `status must be one of: ${[...STATUSES].join(', ')}`;
  }
  if (body.officialEmail && !EMAIL_RE.test(body.officialEmail)) return 'officialEmail is not a valid email address';
  if (body.personalEmail && !EMAIL_RE.test(body.personalEmail)) return 'personalEmail is not a valid email address';
  return null;
}

async function requireTeacher(req, res) {
  const teacherId = Number(req.params.teacherId);
  const teacher = await get('SELECT * FROM teachers WHERE id = ?', [teacherId]);
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return null; }
  return teacher;
}

/** Personal/contact/employment/education/documents completion, computed fresh from real data on
    every read (no stored "onboarding stage" that could drift from the fields it summarizes). */
function computeCompletion(profile, educationCount, documents) {
  const missing = [];
  const sections = {};

  const personalMissing = ['gender', 'dateOfBirth', 'nationality'].filter(f => !profile[f]);
  sections.personal = personalMissing.length === 0;
  missing.push(...personalMissing.map(field => ({ section: 'personal', field })));

  const contactMissing = [];
  if (!profile.phone) contactMissing.push('phone');
  if (!profile.address) contactMissing.push('address');
  if (!profile.officialEmail && !profile.personalEmail) contactMissing.push('email');
  sections.contact = contactMissing.length === 0;
  missing.push(...contactMissing.map(field => ({ section: 'contact', field })));

  const employmentMissing = ['designation', 'employmentType', 'dateOfJoining'].filter(f => !profile[f]);
  sections.employment = employmentMissing.length === 0;
  missing.push(...employmentMissing.map(field => ({ section: 'employment', field })));

  sections.education = educationCount > 0;
  if (!sections.education) missing.push({ section: 'education', field: null });

  sections.documents = documents.length > 0;
  if (!sections.documents) missing.push({ section: 'documents', field: null });

  const total = Object.keys(sections).length;
  const done = Object.values(sections).filter(Boolean).length;
  const percent = Math.round((done / total) * 100);

  let profileStatus;
  if (percent < 100) profileStatus = documents.length === 0 ? 'Documents Pending' : 'Incomplete';
  else profileStatus = documents.some(d => d.verificationStatus === 'Pending') ? 'Under Review' : 'Complete';

  return { percent, sections, missing, profileStatus };
}

/** Lightweight per-teacher summary for the Teacher Management list — one query set for every
    teacher rather than N+1 full-profile fetches. Management view, not a public directory — a
    caller needs teachers:View or finance:Update (Bursar) to browse the whole roster. */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const roles = await getUserRoles(req.user.sub, req.user.role);
  if (!(await hasPermission(roles, 'teachers', 'View')) && !(await hasPermission(roles, 'finance', 'Update'))) {
    return res.status(403).json({ error: 'You do not have permission to do this.', code: 'NO_PERMISSION', module: 'teachers', action: 'View' });
  }
  const teachers = await all('SELECT id FROM teachers');
  // Same backfill-on-read idea as backfillIdNumbers() for users: any teacher without a profile
  // row yet (never had their Full Profile opened) gets one — and an employeeId — right now, so
  // the list always shows a real id instead of leaving it blank until someone visits the page.
  for (const teacher of teachers) await ensureProfileRow(teacher.id);
  const profileByTeacher = new Map((await all('SELECT * FROM teacher_profiles')).map(p => [p.teacherId, p]));
  const eduCountByTeacher = new Map(
    (await all('SELECT teacherId, COUNT(*) as n FROM teacher_education GROUP BY teacherId')).map(r => [r.teacherId, r.n])
  );
  const docsByTeacher = new Map();
  for (const d of await all('SELECT teacherId, verificationStatus FROM teacher_documents')) {
    if (!docsByTeacher.has(d.teacherId)) docsByTeacher.set(d.teacherId, []);
    docsByTeacher.get(d.teacherId).push(d);
  }

  res.json(teachers.map(t => {
    const profile = profileByTeacher.get(t.id) || {};
    const docs = docsByTeacher.get(t.id) || [];
    const { percent, profileStatus } = computeCompletion(profile, eduCountByTeacher.get(t.id) || 0, docs);
    return {
      teacherId: t.id,
      employeeId: profile.employeeId || null,
      designation: profile.designation || null,
      employmentType: profile.employmentType || null,
      status: profile.status || null,
      completionPercent: percent,
      profileStatus,
      documentsCount: docs.length,
      verifiedDocumentsCount: docs.filter(d => d.verificationStatus === 'Verified').length,
    };
  }));
}));

/** Full profile bundle for the edit page: base teacher row, the (lazily-created) HR profile,
    education/experience/certification history, general documents, and computed completion.
    Requires 'full' or 'payroll' access (see teacherAccessLevel) — self, teachers:View roles in
    scope, or Bursar (payroll-only, PII stripped below). Everyone else 403s. */
router.get('/:teacherId', requireAuth, asyncHandler(async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const access = await teacherAccessLevel(req, teacher.id);
  if (access === 'none') return res.status(403).json({ error: 'You do not have permission to view this profile.' });
  await ensureProfileRow(teacher.id);
  const profile = await get('SELECT * FROM teacher_profiles WHERE teacherId = ?', [teacher.id]);
  if (access !== 'full') {
    for (const f of TEACHER_PII_FIELDS) profile[f] = null;
  }
  if (!(await canSeePayroll(req))) profile.payrollId = null;
  const education = await all('SELECT * FROM teacher_education WHERE teacherId = ? ORDER BY year DESC, id DESC', [teacher.id]);
  const experience = await all('SELECT * FROM teacher_experience WHERE teacherId = ? ORDER BY currentlyWorking DESC, startDate DESC, id DESC', [teacher.id]);
  const certifications = await all('SELECT * FROM teacher_certifications WHERE teacherId = ? ORDER BY id DESC', [teacher.id]);
  const documents = await all(
    'SELECT id, docType, fileName, mimeType, issueDate, expiryDate, verificationStatus, verifiedBy, verifiedAt, notes, createdAt FROM teacher_documents WHERE teacherId = ? ORDER BY createdAt DESC',
    [teacher.id]
  );
  const completion = computeCompletion(profile, education.length, documents);
  res.json({ teacher, profile, education, experience, certifications, documents, completion });
}));

router.put('/:teacherId', requireAuth, requireProfileUpdateAccess, asyncHandler(async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const cols = PROFILE_FIELDS.filter(f => req.body[f] !== undefined);
  const wantsPayroll = req.body[PAYROLL_FIELD] !== undefined;
  if (wantsPayroll) {
    if (!(await canSeePayroll(req))) return res.status(403).json({ error: 'You do not have permission to edit payroll information.' });
    cols.push(PAYROLL_FIELD);
  }
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  const validationError = validateProfileFields(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  if (req.body.reportingManagerId != null) {
    if (Number(req.body.reportingManagerId) === teacher.id) return res.status(400).json({ error: 'A faculty member cannot report to themselves' });
    const manager = await get('SELECT id FROM teachers WHERE id = ?', [req.body.reportingManagerId]);
    if (!manager) return res.status(400).json({ error: 'reportingManagerId does not refer to an existing teacher' });
  }
  if (req.body.officialEmail) {
    const dupe = await get('SELECT teacherId FROM teacher_profiles WHERE officialEmail = ? AND teacherId != ?', [req.body.officialEmail, teacher.id]);
    if (dupe) return res.status(409).json({ error: 'This official email is already assigned to another faculty member.' });
  }

  await ensureProfileRow(teacher.id);
  await run(
    `UPDATE teacher_profiles SET ${cols.map(c => `${c} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE teacherId = ?`,
    [...cols.map(c => req.body[c]), teacher.id]
  );
  await logAudit(req.user, 'update', 'teacher_profiles', teacher.id, req.body);
  const updated = await get('SELECT * FROM teacher_profiles WHERE teacherId = ?', [teacher.id]);
  if (!(await canSeePayroll(req))) updated.payrollId = null;
  res.json(updated);
}));

router.post('/:teacherId/photo', requireAuth, requirePermission('teachers.Update', { scopeOf: teacherScopeOf }), upload.single('photo'), asyncHandler(async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  if (!req.file) return res.status(400).json({ error: 'A photo file is required' });
  if (req.file.mimetype !== 'image/png' && req.file.mimetype !== 'image/jpeg') {
    return res.status(400).json({ error: 'Photo must be a PNG or JPEG image.' });
  }
  if (!facultyStorage.FACULTY_ROOT) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });
  await ensureProfileRow(teacher.id);
  const relPath = facultyStorage.saveFile(teacher.id, 'photo', teacher.id, req.file.mimetype, req.file.buffer);
  await run('UPDATE teacher_profiles SET photoPath = ?, updatedAt = CURRENT_TIMESTAMP WHERE teacherId = ?', [relPath, teacher.id]);
  await logAudit(req.user, 'upload-photo', 'teacher_profiles', teacher.id, null);
  res.json(await get('SELECT * FROM teacher_profiles WHERE teacherId = ?', [teacher.id]));
}));

router.get('/:teacherId/photo', requireAuth, asyncHandler(async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const profile = await get('SELECT photoPath FROM teacher_profiles WHERE teacherId = ?', [teacher.id]);
  if (!profile?.photoPath || !facultyStorage.fileExists(profile.photoPath)) return res.status(404).json({ error: 'No photo on file' });
  res.sendFile(facultyStorage.absolutePath(profile.photoPath));
}));

/* ------------------------------- Education ------------------------------- */

router.post('/:teacherId/education', requireAuth, requirePermission('teachers.Create', { scopeOf: teacherScopeOf }), uploadCertAndTranscript, asyncHandler(async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const { degree, fieldOfStudy, institution, country, startYear, year, gpa, notes } = req.body;
  if (!DEGREES.has(degree)) return res.status(400).json({ error: `degree must be one of: ${[...DEGREES].join(', ')}` });
  const certFile = req.files?.file?.[0];
  const transcriptFile = req.files?.transcript?.[0];
  for (const f of [certFile, transcriptFile]) {
    if (f && !facultyStorage.ALLOWED_MIME_TYPES.has(f.mimetype)) return res.status(400).json({ error: 'Files must be a PDF, PNG, or JPEG.' });
  }
  if ((certFile || transcriptFile) && !facultyStorage.FACULTY_ROOT) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });

  const result = await run(
    `INSERT INTO teacher_education (teacherId, degree, fieldOfStudy, institution, country, startYear, year, gpa, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [teacher.id, degree, fieldOfStudy || null, institution || null, country || null,
      startYear ? Number(startYear) : null, year ? Number(year) : null, gpa || null, notes || null]
  );
  if (certFile) {
    const relPath = facultyStorage.saveFile(teacher.id, 'education', result.id, certFile.mimetype, certFile.buffer);
    await run('UPDATE teacher_education SET documentPath = ? WHERE id = ?', [relPath, result.id]);
  }
  if (transcriptFile) {
    const relPath = facultyStorage.saveFile(teacher.id, 'transcript', result.id, transcriptFile.mimetype, transcriptFile.buffer);
    await run('UPDATE teacher_education SET transcriptPath = ? WHERE id = ?', [relPath, result.id]);
  }
  await logAudit(req.user, 'create', 'teacher_education', result.id, { teacherId: teacher.id, degree, institution });
  res.status(201).json(await get('SELECT * FROM teacher_education WHERE id = ?', [result.id]));
}));

router.put('/education/:id', requireAuth, requirePermission('teachers.Update', { scopeOf: relatedScopeOf('teacher_education') }), uploadCertAndTranscript, asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_education WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Education entry not found' });
  if (req.body.degree !== undefined && !DEGREES.has(req.body.degree)) return res.status(400).json({ error: `degree must be one of: ${[...DEGREES].join(', ')}` });

  const fields = ['degree', 'fieldOfStudy', 'institution', 'country', 'gpa', 'notes'];
  const cols = fields.filter(f => req.body[f] !== undefined);
  if (req.body.startYear !== undefined) { cols.push('startYear'); req.body.startYear = req.body.startYear ? Number(req.body.startYear) : null; }
  if (req.body.year !== undefined) { cols.push('year'); req.body.year = req.body.year ? Number(req.body.year) : null; }
  if (cols.length) {
    await run(`UPDATE teacher_education SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => req.body[c]), row.id]);
  }
  const certFile = req.files?.file?.[0];
  const transcriptFile = req.files?.transcript?.[0];
  if (certFile) {
    if (!facultyStorage.ALLOWED_MIME_TYPES.has(certFile.mimetype)) return res.status(400).json({ error: 'Certificate must be a PDF, PNG, or JPEG file.' });
    if (row.documentPath) facultyStorage.deleteFile(row.documentPath);
    const relPath = facultyStorage.saveFile(row.teacherId, 'education', row.id, certFile.mimetype, certFile.buffer);
    await run('UPDATE teacher_education SET documentPath = ? WHERE id = ?', [relPath, row.id]);
  }
  if (transcriptFile) {
    if (!facultyStorage.ALLOWED_MIME_TYPES.has(transcriptFile.mimetype)) return res.status(400).json({ error: 'Transcript must be a PDF, PNG, or JPEG file.' });
    if (row.transcriptPath) facultyStorage.deleteFile(row.transcriptPath);
    const relPath = facultyStorage.saveFile(row.teacherId, 'transcript', row.id, transcriptFile.mimetype, transcriptFile.buffer);
    await run('UPDATE teacher_education SET transcriptPath = ? WHERE id = ?', [relPath, row.id]);
  }
  await logAudit(req.user, 'update', 'teacher_education', row.id, { teacherId: row.teacherId });
  res.json(await get('SELECT * FROM teacher_education WHERE id = ?', [row.id]));
}));

router.delete('/education/:id', requireAuth, requirePermission('teachers.Delete', { scopeOf: relatedScopeOf('teacher_education') }), asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_education WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Education entry not found' });
  await run('DELETE FROM teacher_education WHERE id = ?', [req.params.id]);
  if (row.documentPath) facultyStorage.deleteFile(row.documentPath);
  if (row.transcriptPath) facultyStorage.deleteFile(row.transcriptPath);
  await logAudit(req.user, 'delete', 'teacher_education', req.params.id, { teacherId: row.teacherId, degree: row.degree });
  res.status(204).end();
}));

router.get('/education/:id/certificate', requireAuth, asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_education WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Education entry not found' });
  if ((await teacherAccessLevel(req, row.teacherId)) !== 'full') return res.status(403).json({ error: 'Forbidden' });
  if (!row.documentPath || !facultyStorage.fileExists(row.documentPath)) return res.status(404).json({ error: 'File not found' });
  res.download(facultyStorage.absolutePath(row.documentPath));
}));

router.get('/education/:id/transcript', requireAuth, asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_education WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Education entry not found' });
  if ((await teacherAccessLevel(req, row.teacherId)) !== 'full') return res.status(403).json({ error: 'Forbidden' });
  if (!row.transcriptPath || !facultyStorage.fileExists(row.transcriptPath)) return res.status(404).json({ error: 'File not found' });
  res.download(facultyStorage.absolutePath(row.transcriptPath));
}));

/* ----------------------------- Experience --------------------------------- */

router.post('/:teacherId/experience', requireAuth, requirePermission('teachers.Create', { scopeOf: teacherScopeOf }), upload.single('file'), asyncHandler(async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const { organization, position, department, employmentType, startDate, endDate, currentlyWorking, responsibilities } = req.body;
  if (!organization || !organization.trim()) return res.status(400).json({ error: 'organization is required' });
  if (req.file && !facultyStorage.ALLOWED_MIME_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'Certificate must be a PDF, PNG, or JPEG file.' });
  if (req.file && !facultyStorage.FACULTY_ROOT) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });
  const isCurrent = currentlyWorking === true || currentlyWorking === 'true' || currentlyWorking === '1';

  const result = await run(
    `INSERT INTO teacher_experience (teacherId, organization, position, department, employmentType, startDate, endDate, currentlyWorking, responsibilities)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [teacher.id, organization.trim(), position || null, department || null, employmentType || null,
      startDate || null, isCurrent ? null : (endDate || null), isCurrent ? 1 : 0, responsibilities || null]
  );
  if (req.file) {
    const relPath = facultyStorage.saveFile(teacher.id, 'experience', result.id, req.file.mimetype, req.file.buffer);
    await run('UPDATE teacher_experience SET documentPath = ? WHERE id = ?', [relPath, result.id]);
  }
  await logAudit(req.user, 'create', 'teacher_experience', result.id, { teacherId: teacher.id, organization });
  res.status(201).json(await get('SELECT * FROM teacher_experience WHERE id = ?', [result.id]));
}));

router.put('/experience/:id', requireAuth, requirePermission('teachers.Update', { scopeOf: relatedScopeOf('teacher_experience') }), upload.single('file'), asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_experience WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Experience entry not found' });
  if (req.body.organization !== undefined && !req.body.organization.trim()) return res.status(400).json({ error: 'organization cannot be empty' });

  const fields = ['organization', 'position', 'department', 'employmentType', 'startDate', 'endDate', 'responsibilities'];
  const cols = fields.filter(f => req.body[f] !== undefined);
  if (req.body.currentlyWorking !== undefined) {
    cols.push('currentlyWorking');
    req.body.currentlyWorking = (req.body.currentlyWorking === true || req.body.currentlyWorking === 'true' || req.body.currentlyWorking === '1') ? 1 : 0;
    if (req.body.currentlyWorking) {
      req.body.endDate = null;
      if (!cols.includes('endDate')) cols.push('endDate');
    }
  }
  if (cols.length) {
    await run(`UPDATE teacher_experience SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => req.body[c]), row.id]);
  }
  if (req.file) {
    if (!facultyStorage.ALLOWED_MIME_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'Certificate must be a PDF, PNG, or JPEG file.' });
    if (row.documentPath) facultyStorage.deleteFile(row.documentPath);
    const relPath = facultyStorage.saveFile(row.teacherId, 'experience', row.id, req.file.mimetype, req.file.buffer);
    await run('UPDATE teacher_experience SET documentPath = ? WHERE id = ?', [relPath, row.id]);
  }
  await logAudit(req.user, 'update', 'teacher_experience', row.id, { teacherId: row.teacherId });
  res.json(await get('SELECT * FROM teacher_experience WHERE id = ?', [row.id]));
}));

router.delete('/experience/:id', requireAuth, requirePermission('teachers.Delete', { scopeOf: relatedScopeOf('teacher_experience') }), asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_experience WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Experience entry not found' });
  await run('DELETE FROM teacher_experience WHERE id = ?', [req.params.id]);
  if (row.documentPath) facultyStorage.deleteFile(row.documentPath);
  await logAudit(req.user, 'delete', 'teacher_experience', req.params.id, { teacherId: row.teacherId, organization: row.organization });
  res.status(204).end();
}));

router.get('/experience/:id/document', requireAuth, asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_experience WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Experience entry not found' });
  if ((await teacherAccessLevel(req, row.teacherId)) !== 'full') return res.status(403).json({ error: 'Forbidden' });
  if (!row.documentPath || !facultyStorage.fileExists(row.documentPath)) return res.status(404).json({ error: 'File not found' });
  res.download(facultyStorage.absolutePath(row.documentPath));
}));

/* --------------------------- Certifications -------------------------------- */

router.post('/:teacherId/certifications', requireAuth, requirePermission('teachers.Create', { scopeOf: teacherScopeOf }), upload.single('file'), asyncHandler(async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const { name, issuingOrganization, certificationNumber, issueDate, expiryDate, doesNotExpire } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (req.file && !facultyStorage.ALLOWED_MIME_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'Certificate must be a PDF, PNG, or JPEG file.' });
  if (req.file && !facultyStorage.FACULTY_ROOT) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });
  const noExpiry = doesNotExpire === true || doesNotExpire === 'true' || doesNotExpire === '1';

  const result = await run(
    `INSERT INTO teacher_certifications (teacherId, name, issuingOrganization, certificationNumber, issueDate, expiryDate, doesNotExpire)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [teacher.id, name.trim(), issuingOrganization || null, certificationNumber || null,
      issueDate || null, noExpiry ? null : (expiryDate || null), noExpiry ? 1 : 0]
  );
  if (req.file) {
    const relPath = facultyStorage.saveFile(teacher.id, 'certification', result.id, req.file.mimetype, req.file.buffer);
    await run('UPDATE teacher_certifications SET documentPath = ? WHERE id = ?', [relPath, result.id]);
  }
  await logAudit(req.user, 'create', 'teacher_certifications', result.id, { teacherId: teacher.id, name });
  res.status(201).json(await get('SELECT * FROM teacher_certifications WHERE id = ?', [result.id]));
}));

router.put('/certifications/:id', requireAuth, requirePermission('teachers.Update', { scopeOf: relatedScopeOf('teacher_certifications') }), upload.single('file'), asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_certifications WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Certification not found' });
  if (req.body.name !== undefined && !req.body.name.trim()) return res.status(400).json({ error: 'name cannot be empty' });

  const fields = ['name', 'issuingOrganization', 'certificationNumber', 'issueDate', 'expiryDate'];
  const cols = fields.filter(f => req.body[f] !== undefined);
  if (req.body.doesNotExpire !== undefined) {
    cols.push('doesNotExpire');
    req.body.doesNotExpire = (req.body.doesNotExpire === true || req.body.doesNotExpire === 'true' || req.body.doesNotExpire === '1') ? 1 : 0;
    if (req.body.doesNotExpire) { req.body.expiryDate = null; if (!cols.includes('expiryDate')) cols.push('expiryDate'); }
  }
  if (cols.length) {
    await run(`UPDATE teacher_certifications SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => req.body[c]), row.id]);
  }
  if (req.file) {
    if (!facultyStorage.ALLOWED_MIME_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'Certificate must be a PDF, PNG, or JPEG file.' });
    if (row.documentPath) facultyStorage.deleteFile(row.documentPath);
    const relPath = facultyStorage.saveFile(row.teacherId, 'certification', row.id, req.file.mimetype, req.file.buffer);
    await run('UPDATE teacher_certifications SET documentPath = ? WHERE id = ?', [relPath, row.id]);
  }
  await logAudit(req.user, 'update', 'teacher_certifications', row.id, { teacherId: row.teacherId });
  res.json(await get('SELECT * FROM teacher_certifications WHERE id = ?', [row.id]));
}));

router.delete('/certifications/:id', requireAuth, requirePermission('teachers.Delete', { scopeOf: relatedScopeOf('teacher_certifications') }), asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_certifications WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Certification not found' });
  await run('DELETE FROM teacher_certifications WHERE id = ?', [req.params.id]);
  if (row.documentPath) facultyStorage.deleteFile(row.documentPath);
  await logAudit(req.user, 'delete', 'teacher_certifications', req.params.id, { teacherId: row.teacherId, name: row.name });
  res.status(204).end();
}));

router.get('/certifications/:id/document', requireAuth, asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM teacher_certifications WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Certification not found' });
  if ((await teacherAccessLevel(req, row.teacherId)) !== 'full') return res.status(403).json({ error: 'Forbidden' });
  if (!row.documentPath || !facultyStorage.fileExists(row.documentPath)) return res.status(404).json({ error: 'File not found' });
  res.download(facultyStorage.absolutePath(row.documentPath));
}));

/* ------------------------------ Documents ---------------------------------- */

router.post('/:teacherId/documents', requireAuth, requirePermission('teachers.Create', { scopeOf: teacherScopeOf }), upload.single('file'), asyncHandler(async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const { docType, issueDate, expiryDate } = req.body;
  if (!DOC_TYPES.has(docType)) return res.status(400).json({ error: `docType must be one of: ${[...DOC_TYPES].join(', ')}` });
  if (!req.file) return res.status(400).json({ error: 'A file is required' });
  if (!facultyStorage.ALLOWED_MIME_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'That file type is not supported.' });
  if (!facultyStorage.FACULTY_ROOT) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });

  const result = await run(
    'INSERT INTO teacher_documents (teacherId, docType, filePath, fileName, mimeType, uploadedBy, issueDate, expiryDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [teacher.id, docType, '', req.file.originalname, req.file.mimetype, req.user.sub, issueDate || null, expiryDate || null]
  );
  const relPath = facultyStorage.saveFile(teacher.id, 'document', result.id, req.file.mimetype, req.file.buffer);
  await run('UPDATE teacher_documents SET filePath = ? WHERE id = ?', [relPath, result.id]);
  await logAudit(req.user, 'upload-document', 'teacher_documents', result.id, { teacherId: teacher.id, docType });
  res.status(201).json(await get(
    'SELECT id, docType, fileName, mimeType, issueDate, expiryDate, verificationStatus, verifiedBy, verifiedAt, notes, createdAt FROM teacher_documents WHERE id = ?',
    [result.id]
  ));
}));

router.get('/documents/:id/file', requireAuth, asyncHandler(async (req, res) => {
  const doc = await get('SELECT * FROM teacher_documents WHERE id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if ((await teacherAccessLevel(req, doc.teacherId)) !== 'full') return res.status(403).json({ error: 'Forbidden' });
  if (!facultyStorage.fileExists(doc.filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(facultyStorage.absolutePath(doc.filePath), doc.fileName);
}));

router.delete('/documents/:id', requireAuth, requirePermission('teachers.Delete', { scopeOf: relatedScopeOf('teacher_documents') }), asyncHandler(async (req, res) => {
  const doc = await get('SELECT * FROM teacher_documents WHERE id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  await run('DELETE FROM teacher_documents WHERE id = ?', [req.params.id]);
  facultyStorage.deleteFile(doc.filePath);
  await logAudit(req.user, 'delete-document', 'teacher_documents', req.params.id, { teacherId: doc.teacherId, docType: doc.docType });
  res.status(204).end();
}));

/* ------------------------- Verification (shared) --------------------------- */
// Qualifications, experience, certifications and documents all carry a verificationStatus —
// registered once here rather than four near-identical route pairs. Only teacher_documents has
// the richer verifiedBy/verifiedAt/notes trail (matches its schema — see db.js).
const VERIFIABLE = [
  { segment: 'education', table: 'teacher_education' },
  { segment: 'experience', table: 'teacher_experience' },
  { segment: 'certifications', table: 'teacher_certifications' },
  { segment: 'documents', table: 'teacher_documents' },
];
for (const { segment, table } of VERIFIABLE) {
  const scopeOf = relatedScopeOf(table);
  const extended = table === 'teacher_documents';

  router.put(`/${segment}/:id/verify`, requireAuth, requirePermission('teachers.Update', { scopeOf }), asyncHandler(async (req, res) => {
    const row = await get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (extended) {
      await run(`UPDATE ${table} SET verificationStatus = 'Verified', verifiedBy = ?, verifiedAt = CURRENT_TIMESTAMP, notes = NULL WHERE id = ?`, [req.user.sub, row.id]);
    } else {
      await run(`UPDATE ${table} SET verificationStatus = 'Verified' WHERE id = ?`, [row.id]);
    }
    await logAudit(req.user, 'verify', table, row.id, { teacherId: row.teacherId });
    res.json(await get(`SELECT * FROM ${table} WHERE id = ?`, [row.id]));
  }));

  router.put(`/${segment}/:id/reject`, requireAuth, requirePermission('teachers.Update', { scopeOf }), asyncHandler(async (req, res) => {
    const row = await get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (extended) {
      await run(`UPDATE ${table} SET verificationStatus = 'Rejected', verifiedBy = ?, verifiedAt = CURRENT_TIMESTAMP, notes = ? WHERE id = ?`, [req.user.sub, req.body.notes || null, row.id]);
    } else {
      await run(`UPDATE ${table} SET verificationStatus = 'Rejected' WHERE id = ?`, [row.id]);
    }
    await logAudit(req.user, 'reject', table, row.id, { teacherId: row.teacherId, notes: req.body.notes });
    res.json(await get(`SELECT * FROM ${table} WHERE id = ?`, [row.id]));
  }));
}

module.exports = router;
