const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { all, get, run, logAudit, findUserByEmail, nextIdNumberForRole, DB_PATH } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const { departmentScopeClause, isScopedRequest, departmentInScope } = require('../scope');
const asyncHandler = require('../middleware/asyncHandler');
const { isValidEmail } = require('../validate');
const { createAccountWithTempPassword } = require('../accounts');
const { sendMail } = require('../mailer');
const { createNotification } = require('../notificationTypes');
const { AID_TYPES, AID_BASES, resyncApplicationAidForBilledTerms } = require('../finance');

const router = express.Router();

// Same next-to-DB_PATH convention as STUDENT_DOCS_DIR in studentProfile.js.
const APPLICATION_DOCS_DIR = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'application-documents');
const STUDENT_DOCS_DIR = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'student-documents');
const appDocFile = (id) => path.join(APPLICATION_DOCS_DIR, String(id));
const ALLOWED_DOC_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// The public submission endpoint is the first unauthenticated POST route in this app — rate
// limited per IP (separate instance from app.js's authLimiter, tuned for a low-frequency form
// rather than login brute-force).
const applicationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.APPLICATION_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many applications submitted from this network — please try again later.' },
});

const STATUSES = ['Submitted', 'Under Review', 'Entry Test Scheduled', 'Waitlisted', 'Accepted', 'Rejected'];
// 'Accepted' is only reachable through POST /:id/approve (it does far more than flip a status
// column), so it's deliberately excluded from the plain status-update route below.
const STATUSES_VIA_ROUTE = STATUSES.filter(s => s !== 'Accepted');
// Transitions meaningful enough to email the applicant about — Submitted -> Under Review is
// routine internal triage, not worth a notification.
const EMAIL_ON_STATUS = new Set(['Entry Test Scheduled', 'Waitlisted', 'Rejected']);

const NUMERIC_FIELDS = new Set(['previousGraduationYear', 'desiredDepartmentId', 'entryTestMarks', 'aidValue']);
// Every applications column an admin may correct after intake.
const ADMIN_FIELDS = [
  'fullName', 'fatherName', 'grandfatherName', 'gender', 'dateOfBirth', 'nationality', 'nationalId', 'passportNumber',
  'presentAddress', 'permanentAddress', 'mobileNumber', 'emergencyContact', 'personalEmail',
  'previousSchoolName', 'previousGraduationYear', 'desiredDepartmentId', 'entryTestMarks',
  'aidType', 'aidBasis', 'aidValue', 'aidReason',
];
function statusMessage(orgName, status, decisionNote) {
  const lines = {
    'Entry Test Scheduled': `Your entry test has been scheduled. ${orgName} admissions will be in touch with the details.`,
    'Waitlisted': `Your application has been waitlisted. We'll contact you if a seat becomes available.`,
    'Rejected': `We're sorry to let you know your application was not successful this time.`,
  };
  let text = `Application status update from ${orgName}\n\nYour application status is now: ${status}.\n\n${lines[status] || ''}`;
  if (decisionNote) text += `\n\nNote from admissions: ${decisionNote}`;
  return text;
}

async function getSetting(key, fallback = null) {
  const row = await get('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value || fallback;
}

function validateIntakeBody(body) {
  if (!String(body.fullName || '').trim()) return 'Full name is required.';
  if (!isValidEmail(body.personalEmail || '')) return 'Enter a valid personal email address.';
  for (const f of NUMERIC_FIELDS) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== '' && Number.isNaN(Number(body[f]))) {
      return `${f} must be a number`;
    }
  }
  return null;
}

async function insertApplication(body, { source, createdBy }) {
  const desiredDepartmentId = body.desiredDepartmentId ? Number(body.desiredDepartmentId) : null;
  if (desiredDepartmentId) {
    const dept = await get('SELECT id FROM departments WHERE id = ?', [desiredDepartmentId]);
    if (!dept) throw Object.assign(new Error('That department does not exist.'), { status: 400 });
  }
  const result = await run(
    `INSERT INTO applications (
      fullName, fatherName, grandfatherName, gender, dateOfBirth, nationality, nationalId, passportNumber,
      presentAddress, permanentAddress, mobileNumber, emergencyContact, personalEmail,
      previousSchoolName, previousGraduationYear, desiredDepartmentId, entryTestMarks, source, createdBy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.fullName.trim(), body.fatherName || null, body.grandfatherName || null, body.gender || null,
      body.dateOfBirth || null, body.nationality || null, body.nationalId || null, body.passportNumber || null,
      body.presentAddress || null, body.permanentAddress || null, body.mobileNumber || null, body.emergencyContact || null,
      body.personalEmail.trim().toLowerCase(),
      body.previousSchoolName || null, body.previousGraduationYear ? Number(body.previousGraduationYear) : null,
      desiredDepartmentId, body.entryTestMarks !== undefined && body.entryTestMarks !== '' ? Number(body.entryTestMarks) : null,
      source, createdBy || null,
    ]
  );
  return result.id;
}

async function notifyAdmins(message, applicationId) {
  const admins = await all(`SELECT id FROM users WHERE role = 'admin'`);
  for (const a of admins) {
    await createNotification(a.id, message, 'application_submitted', { entityType: 'application', entityId: applicationId });
  }
}

// --- Public intake — no requireAuth ---

// The public application form needs a department list to choose "desired department" from —
// nothing sensitive in a department name, same reasoning as GET /settings/branding being public.
router.get('/departments', asyncHandler(async (req, res) => {
  res.json(await all('SELECT id, name FROM departments ORDER BY name'));
}));

router.post('/', applicationLimiter, upload.array('documents', 10), asyncHandler(async (req, res) => {
  const error = validateIntakeBody(req.body);
  if (error) return res.status(400).json({ error });

  let applicationId;
  try {
    applicationId = await insertApplication(req.body, { source: 'public' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  if (req.files?.length) {
    if (!APPLICATION_DOCS_DIR) return res.status(400).json({ error: 'Cannot store files for an in-memory database' });
    fs.mkdirSync(APPLICATION_DOCS_DIR, { recursive: true });
    for (const file of req.files) {
      if (!ALLOWED_DOC_TYPES.has(file.mimetype)) continue; // silently skip unsupported types on the public form
      const result = await run(
        'INSERT INTO application_documents (applicationId, documentType, title, fileName, mimeType) VALUES (?, ?, ?, ?, ?)',
        [applicationId, 'Other', file.originalname, file.originalname, file.mimetype]
      );
      fs.writeFileSync(appDocFile(result.id), file.buffer);
    }
  }

  const applicant = await get('SELECT fullName FROM applications WHERE id = ?', [applicationId]);
  await notifyAdmins(`New application submitted by ${applicant.fullName}.`, applicationId);

  res.status(201).json({ id: applicationId });
}));

// --- Admin-only from here down ---

router.post('/admin', requireAuth, requirePermission('admissions', 'write'), asyncHandler(async (req, res) => {
  const error = validateIntakeBody(req.body);
  if (error) return res.status(400).json({ error });
  let applicationId;
  try {
    applicationId = await insertApplication(req.body, { source: 'admin', createdBy: req.user.sub });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  await logAudit(req.user, 'create', 'applications', applicationId, { fullName: req.body.fullName });
  res.status(201).json(await get('SELECT * FROM applications WHERE id = ?', [applicationId]));
}));

router.get('/', requireAuth, requirePermission('admissions', 'read'), asyncHandler(async (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.status) { clauses.push('a.status = ?'); params.push(req.query.status); }
  if (req.query.departmentId) { clauses.push('a.desiredDepartmentId = ?'); params.push(req.query.departmentId); }
  // A department-restricted reader (Department Head / Dean) only sees
  // applications to their own department(s), whatever filter they pass.
  const scope = departmentScopeClause(req, 'a.desiredDepartmentId');
  if (scope) { clauses.push(scope.clause); params.push(...scope.params); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await all(
    `SELECT a.*, d.name as desiredDepartmentName
     FROM applications a LEFT JOIN departments d ON d.id = a.desiredDepartmentId
     ${where} ORDER BY a.createdAt DESC`,
    params
  );
  res.json(rows);
}));

router.get('/:id', requireAuth, requirePermission('admissions', 'read'), asyncHandler(async (req, res) => {
  const application = await get(
    `SELECT a.*, d.name as desiredDepartmentName
     FROM applications a LEFT JOIN departments d ON d.id = a.desiredDepartmentId WHERE a.id = ?`,
    [req.params.id]
  );
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (isScopedRequest(req) && !departmentInScope(req, application.desiredDepartmentId)) {
    return res.status(404).json({ error: 'Application not found' });
  }
  const documents = await all(
    'SELECT id, documentType, title, fileName, mimeType, createdAt FROM application_documents WHERE applicationId = ? ORDER BY createdAt DESC',
    [req.params.id]
  );
  res.json({ ...application, documents });
}));

router.put('/:id', requireAuth, requirePermission('admissions', 'write'), asyncHandler(async (req, res) => {
  const application = await get('SELECT * FROM applications WHERE id = ?', [req.params.id]);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  // The financial aid panel submits '' for "no aid" / a cleared field — normalize to null so it
  // reads the same as never having been set, rather than storing an empty string.
  for (const f of ['aidType', 'aidBasis', 'aidValue', 'aidReason']) {
    if (req.body[f] === '') req.body[f] = null;
  }
  const cols = ADMIN_FIELDS.filter(f => req.body[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  if (cols.includes('personalEmail') && !isValidEmail(req.body.personalEmail)) {
    return res.status(400).json({ error: 'Enter a valid personal email address.' });
  }
  for (const f of NUMERIC_FIELDS) {
    if (cols.includes(f) && req.body[f] !== null && Number.isNaN(Number(req.body[f]))) {
      return res.status(400).json({ error: `${f} must be a number` });
    }
  }
  if (cols.includes('aidType') && req.body.aidType !== null && !AID_TYPES.includes(req.body.aidType)) {
    return res.status(400).json({ error: `aidType must be one of: ${AID_TYPES.join(', ')}` });
  }
  if (cols.includes('aidBasis') && req.body.aidBasis !== null && !AID_BASES.includes(req.body.aidBasis)) {
    return res.status(400).json({ error: `aidBasis must be one of: ${AID_BASES.join(', ')}` });
  }
  if (cols.includes('aidValue') && req.body.aidValue !== null) {
    const n = Number(req.body.aidValue);
    if (!(n > 0)) return res.status(400).json({ error: 'aidValue must be a positive number' });
    if (req.body.aidBasis === 'percentage' && n > 100) return res.status(400).json({ error: 'A percentage award cannot exceed 100' });
  }
  const values = cols.map(c => (NUMERIC_FIELDS.has(c) && req.body[c] !== null ? Number(req.body[c]) : req.body[c]));
  await run(
    `UPDATE applications SET ${cols.map(c => `${c} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    [...values, req.params.id]
  );
  await logAudit(req.user, 'update', 'applications', req.params.id, req.body);
  // If this application has already been converted to a student, an aid edit should be reflected
  // in any term they're already billed for right away, not silently wait for the next "Generate
  // charges" run for that term.
  if (application.createdStudentId && cols.some(f => f.startsWith('aid'))) {
    await resyncApplicationAidForBilledTerms(application.createdStudentId, req.user);
  }
  res.json(await get('SELECT * FROM applications WHERE id = ?', [req.params.id]));
}));

router.put('/:id/status', requireAuth, requirePermission('admissions', 'write'), asyncHandler(async (req, res) => {
  const { status, decisionNote } = req.body;
  if (!STATUSES_VIA_ROUTE.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES_VIA_ROUTE.join(', ')}` });
  }
  const application = await get('SELECT * FROM applications WHERE id = ?', [req.params.id]);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.status === 'Accepted') {
    return res.status(409).json({ error: 'This application has already been accepted and converted to a student account.' });
  }

  const isDecision = status === 'Rejected';
  await run(
    `UPDATE applications SET status = ?, decisionNote = ?${isDecision ? ', decidedBy = ?, decidedAt = CURRENT_TIMESTAMP' : ''}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    isDecision ? [status, decisionNote ?? null, req.user.sub, req.params.id] : [status, decisionNote ?? null, req.params.id]
  );
  await logAudit(req.user, 'update-status', 'applications', req.params.id, { status, decisionNote });

  let emailResult = { sent: false, reason: 'No email is sent for this status change.' };
  if (EMAIL_ON_STATUS.has(status)) {
    const orgName = await getSetting('orgName', 'the university');
    emailResult = await sendMail({
      to: application.personalEmail,
      subject: `Application status update — ${orgName}`,
      text: statusMessage(orgName, status, decisionNote),
    });
  }

  res.json({ ...(await get('SELECT * FROM applications WHERE id = ?', [req.params.id])), emailSent: emailResult.sent, emailError: emailResult.sent ? null : emailResult.reason });
}));

router.post('/:id/approve', requireAuth, requirePermission('admissions', 'write'), asyncHandler(async (req, res) => {
  const application = await get('SELECT * FROM applications WHERE id = ?', [req.params.id]);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.status === 'Accepted') return res.status(409).json({ error: 'This application has already been accepted.' });

  const departmentId = req.body.departmentId ? Number(req.body.departmentId) : application.desiredDepartmentId;
  const programSemester = req.body.programSemester ? Number(req.body.programSemester) : 1;
  if (!departmentId) return res.status(400).json({ error: 'A department is required to approve this application.' });
  const dept = await get('SELECT id FROM departments WHERE id = ?', [departmentId]);
  if (!dept) return res.status(400).json({ error: 'That department does not exist.' });

  const idNumber = await nextIdNumberForRole('student');
  const domain = await getSetting('emailDomain', 'student.university.edu');
  const generatedEmail = `${idNumber}@${domain}`.toLowerCase();
  if (await findUserByEmail(generatedEmail)) {
    return res.status(409).json({ error: 'The auto-generated email already exists — please retry.' });
  }

  const account = await createAccountWithTempPassword({ name: application.fullName, email: generatedEmail, role: 'student' });

  await run('INSERT OR IGNORE INTO student_profiles (studentId) VALUES (?)', [account.id]);
  await run(
    `UPDATE student_profiles SET
       fatherName = ?, grandfatherName = ?, gender = ?, dateOfBirth = ?, nationality = ?, nationalId = ?, passportNumber = ?,
       presentAddress = ?, permanentAddress = ?, mobileNumber = ?, emergencyContact = ?,
       entryTestMarks = ?, departmentId = ?, programSemester = ?,
       previousSchoolName = ?, previousGraduationYear = ?,
       applicationId = ?, enrollmentDate = DATE('now'),
       admissionStatus = 'Approved', enrollmentStatus = 'Regular', updatedAt = CURRENT_TIMESTAMP
     WHERE studentId = ?`,
    [
      application.fatherName, application.grandfatherName, application.gender, application.dateOfBirth,
      application.nationality, application.nationalId, application.passportNumber,
      application.presentAddress, application.permanentAddress, application.mobileNumber, application.emergencyContact,
      application.entryTestMarks, departmentId, programSemester,
      application.previousSchoolName, application.previousGraduationYear,
      req.params.id,
      account.id,
    ]
  );

  const appDocs = await all('SELECT * FROM application_documents WHERE applicationId = ?', [req.params.id]);
  if (appDocs.length && STUDENT_DOCS_DIR) fs.mkdirSync(STUDENT_DOCS_DIR, { recursive: true });
  for (const doc of appDocs) {
    const srcPath = APPLICATION_DOCS_DIR ? appDocFile(doc.id) : null;
    if (!srcPath || !fs.existsSync(srcPath)) continue;
    const copied = await run(
      'INSERT INTO student_documents (studentId, documentType, title, fileName, mimeType, uploadedBy) VALUES (?, ?, ?, ?, ?, ?)',
      [account.id, doc.documentType, doc.title, doc.fileName, doc.mimeType, req.user.sub]
    );
    fs.copyFileSync(srcPath, path.join(STUDENT_DOCS_DIR, String(copied.id)));
  }

  await run(
    `UPDATE applications SET status = 'Accepted', decidedBy = ?, decidedAt = CURRENT_TIMESTAMP, createdStudentId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    [req.user.sub, account.id, req.params.id]
  );

  const orgName = await getSetting('orgName', 'the university');
  const emailResult = await sendMail({
    to: application.personalEmail,
    subject: `Welcome to ${orgName} — your student account`,
    text: `Congratulations, ${application.fullName}!\n\nYour application has been accepted. Your new student account:\n\n`
      + `Student ID: ${idNumber}\nUniversity email: ${generatedEmail}\nTemporary password: ${account.tempPassword}\n\n`
      + `Log in with these credentials — you'll be asked to set your own password right away.`,
  });

  await logAudit(req.user, 'approve-application', 'applications', req.params.id, { studentId: account.id, idNumber });

  res.json({
    student: { id: account.id, name: application.fullName, email: generatedEmail, idNumber },
    tempPassword: account.tempPassword,
    emailSent: emailResult.sent,
    emailError: emailResult.sent ? null : emailResult.reason,
  });
}));

router.post('/:id/documents', requireAuth, requirePermission('admissions', 'write'), upload.single('file'), asyncHandler(async (req, res) => {
  const application = await get('SELECT id FROM applications WHERE id = ?', [req.params.id]);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  const { documentType, title } = req.body;
  if (!String(documentType || '').trim() || !String(title || '').trim()) {
    return res.status(400).json({ error: 'documentType and title are required' });
  }
  if (!req.file) return res.status(400).json({ error: 'A file is required' });
  if (!ALLOWED_DOC_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'That file type is not supported.' });
  if (!APPLICATION_DOCS_DIR) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });

  const result = await run(
    'INSERT INTO application_documents (applicationId, documentType, title, fileName, mimeType, uploadedBy) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, documentType.trim(), title.trim(), req.file.originalname, req.file.mimetype, req.user.sub]
  );
  fs.mkdirSync(APPLICATION_DOCS_DIR, { recursive: true });
  fs.writeFileSync(appDocFile(result.id), req.file.buffer);
  await logAudit(req.user, 'upload-document', 'application_documents', result.id, { applicationId: req.params.id, title: title.trim() });

  res.status(201).json(await get('SELECT id, documentType, title, fileName, mimeType, createdAt FROM application_documents WHERE id = ?', [result.id]));
}));

router.get('/:id/documents/:docId/file', requireAuth, requirePermission('admissions', 'read'), asyncHandler(async (req, res) => {
  const doc = await get('SELECT * FROM application_documents WHERE id = ? AND applicationId = ?', [req.params.docId, req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!APPLICATION_DOCS_DIR || !fs.existsSync(appDocFile(doc.id))) return res.status(404).json({ error: 'File not found' });
  res.download(appDocFile(doc.id), doc.fileName);
}));

router.delete('/:id/documents/:docId', requireAuth, requirePermission('admissions', 'write'), asyncHandler(async (req, res) => {
  const doc = await get('SELECT * FROM application_documents WHERE id = ? AND applicationId = ?', [req.params.docId, req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  await run('DELETE FROM application_documents WHERE id = ?', [req.params.docId]);
  if (APPLICATION_DOCS_DIR) { try { fs.unlinkSync(appDocFile(doc.id)); } catch { /* already gone */ } }
  await logAudit(req.user, 'delete-document', 'application_documents', req.params.docId, { applicationId: req.params.id });
  res.status(204).end();
}));

module.exports = router;
