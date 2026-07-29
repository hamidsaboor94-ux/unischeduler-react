const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const asyncHandler = require('../middleware/asyncHandler');
const { departmentScopeClause, departmentInScope } = require('../scope');
const { studentStatement } = require('../finance');
const { discoverStudents } = require('../studentDiscovery');

const router = express.Router();

/**
 * The canonical academic view of every role='student' user — search/filter/paginated list plus a
 * per-student overview (application + enrollments + finance summary) that composes data already
 * owned by admissions/enrollment/finance rather than re-deriving it. Profile fields themselves
 * (personal/contact/educational, GPA, documents, photo, semester progression) stay on
 * GET /student-profile/:studentId and /progression/:studentId/* — this module only adds what
 * those endpoints don't already serve: browsing/searching/filtering the whole population, CSV
 * export, and lightweight bulk edits (status/department/program).
 */

// Kept in sync with STUDENT_STATUSES in routes/studentProfile.js — duplicated locally rather than
// exported/imported since it's a small validation set, same pattern as other file-local enums
// throughout the route layer (e.g. ENROLLMENT_STATUSES).
const STUDENT_STATUSES = new Set(['Active', 'Graduated', 'Suspended', 'Withdrawn', 'On Leave']);
// Fields PUT /students/bulk may change — deliberately a small subset of studentProfile.js's
// ADMIN_FIELDS. Never programSemester/semesterStatus (progression-engine-owned, see
// academicProgression.js) and never anything requiring per-row validation beyond an id/enum check.
const BULK_FIELDS = new Set(['studentStatus', 'departmentId', 'programId']);
const MAX_PAGE_SIZE = 100;
const EXPORT_ROW_CAP = 5000;

/** Builds the shared WHERE clause + params for both the list and export endpoints, from the same
    query params, so the two can never drift apart on what a given filter set matches. */
function buildFilters(req) {
  const clauses = [`u.role = 'student'`];
  const params = [];

  const scope = departmentScopeClause(req, 'sp.departmentId');
  if (scope) { clauses.push(scope.clause); params.push(...scope.params); }

  if (req.query.departmentId) { clauses.push('sp.departmentId = ?'); params.push(Number(req.query.departmentId)); }
  if (req.query.collegeId) { clauses.push('d.collegeId = ?'); params.push(Number(req.query.collegeId)); }
  if (req.query.programId) { clauses.push('sp.programId = ?'); params.push(Number(req.query.programId)); }
  if (req.query.studentTypeId) { clauses.push('sp.studentTypeId = ?'); params.push(Number(req.query.studentTypeId)); }
  if (req.query.status) { clauses.push('sp.enrollmentStatus = ?'); params.push(req.query.status); }
  if (req.query.studentStatus) { clauses.push('sp.studentStatus = ?'); params.push(req.query.studentStatus); }
  if (req.query.semester) { clauses.push('sp.programSemester = ?'); params.push(Number(req.query.semester)); }
  if (req.query.batch) { clauses.push('sp.batch = ?'); params.push(req.query.batch); }
  if (req.query.courseId) {
    clauses.push('EXISTS (SELECT 1 FROM enrollments e WHERE e.studentId = u.id AND e.courseId = ? AND e.deletedAt IS NULL)');
    params.push(Number(req.query.courseId));
  }
  if (req.query.admissionDateFrom) { clauses.push('sp.enrollmentDate >= ?'); params.push(req.query.admissionDateFrom); }
  if (req.query.admissionDateTo) { clauses.push('sp.enrollmentDate <= ?'); params.push(req.query.admissionDateTo); }
  if (req.query.search) {
    clauses.push('(u.name LIKE ? OR u.email LIKE ? OR u.idNumber LIKE ? OR sp.mobileNumber LIKE ?)');
    const like = `%${req.query.search.trim()}%`;
    params.push(like, like, like, like);
  }
  // Powers the Registrar dashboard's "Students not yet registered this term" queue link — students
  // with no enrolled/waitlisted row in the given term.
  if (req.query.notRegisteredTermId) {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.courseId
       WHERE e.studentId = u.id AND c.termId = ? AND e.status IN ('enrolled', 'waitlisted') AND e.deletedAt IS NULL)`
    );
    params.push(Number(req.query.notRegisteredTermId));
  }

  // Flagged (data-integrity) rows only make sense to merge in when nothing structural beyond
  // search is filtering the real population — they have no department/program/status of their
  // own to match against, so any of those filters should exclude them rather than silently ignore
  // the filter for them.
  const structuralFilters = ['departmentId', 'collegeId', 'programId', 'studentTypeId', 'status',
    'studentStatus', 'semester', 'batch', 'courseId', 'admissionDateFrom', 'admissionDateTo', 'notRegisteredTermId']
    .some(k => req.query[k]);

  return { clauses, params, scope, structuralFilters };
}

router.get('/', requireAuth, requirePermission('students', 'read'), asyncHandler(async (req, res) => {
  const { clauses, params, scope, structuralFilters } = buildFilters(req);
  const where = clauses.join(' AND ');

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));

  const totalRow = await get(
    `SELECT COUNT(*) as n FROM users u LEFT JOIN student_profiles sp ON sp.studentId = u.id
     LEFT JOIN departments d ON d.id = sp.departmentId WHERE ${where}`,
    params
  );

  const rows = await all(
    `SELECT u.id, u.name, u.email, u.idNumber, u.createdAt,
            sp.departmentId, d.name as departmentName, d.collegeId,
            sp.programId, p.name as programName,
            sp.studentTypeId, st.name as studentTypeName,
            sp.programSemester, sp.enrollmentStatus, sp.studentStatus, sp.admissionStatus,
            sp.batch, sp.mobileNumber, sp.photoPath,
            sp.applicationId, sp.enrollmentDate
     FROM users u
     LEFT JOIN student_profiles sp ON sp.studentId = u.id
     LEFT JOIN departments d ON d.id = sp.departmentId
     LEFT JOIN programs p ON p.id = sp.programId
     LEFT JOIN student_types st ON st.id = sp.studentTypeId
     WHERE ${where}
     ORDER BY u.name
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  const linked = rows.map(r => ({ ...r, kind: 'linked' }));

  let items = linked;
  // Role-mismatch/orphan reconciliation is an institution-wide records concern, not a
  // departmental one — only surfaced to roles with no department-scope restriction, and only
  // alongside the first page of an otherwise-unfiltered browse (see buildFilters' comment).
  if (!scope && !structuralFilters && page === 1) {
    const { flagged } = await discoverStudents();
    const search = req.query.search ? req.query.search.trim().toLowerCase() : '';
    const flaggedFiltered = flagged.filter(f =>
      !search || [f.name, f.email, f.idNumber].filter(Boolean).some(v => v.toLowerCase().includes(search))
    );
    items = [...linked, ...flaggedFiltered.map(f => ({ ...f, kind: f.kind || 'flagged' }))];
  }

  res.json({ items, total: totalRow.n, page, pageSize });
}));

router.get('/export', requireAuth, requirePermission('students', 'read'), asyncHandler(async (req, res) => {
  const { clauses, params } = buildFilters(req);
  const where = clauses.join(' AND ');
  const rows = await all(
    `SELECT u.id, u.name, u.email, u.idNumber, u.createdAt,
            sp.departmentId, d.name as departmentName,
            sp.programId, p.name as programName,
            sp.studentTypeId, st.name as studentTypeName,
            sp.programSemester, sp.enrollmentStatus, sp.studentStatus, sp.admissionStatus,
            sp.batch, sp.mobileNumber, sp.enrollmentDate
     FROM users u
     LEFT JOIN student_profiles sp ON sp.studentId = u.id
     LEFT JOIN departments d ON d.id = sp.departmentId
     LEFT JOIN programs p ON p.id = sp.programId
     LEFT JOIN student_types st ON st.id = sp.studentTypeId
     WHERE ${where}
     ORDER BY u.name
     LIMIT ?`,
    [...params, EXPORT_ROW_CAP]
  );
  res.json(rows);
}));

router.put('/bulk', requireAuth, requirePermission('students', 'write'), asyncHandler(async (req, res) => {
  const { studentIds, changes, reason } = req.body;
  if (!Array.isArray(studentIds) || !studentIds.length) return res.status(400).json({ error: 'studentIds must be a non-empty array' });
  if (!changes || typeof changes !== 'object') return res.status(400).json({ error: 'changes is required' });
  const cols = Object.keys(changes).filter(k => BULK_FIELDS.has(k) && changes[k] !== undefined);
  if (!cols.length) return res.status(400).json({ error: `changes must include at least one of: ${[...BULK_FIELDS].join(', ')}` });
  if (changes.studentStatus != null && !STUDENT_STATUSES.has(changes.studentStatus)) {
    return res.status(400).json({ error: `studentStatus must be one of: ${[...STUDENT_STATUSES].join(', ')}` });
  }
  if (changes.departmentId != null) {
    const dept = await get('SELECT id FROM departments WHERE id = ?', [Number(changes.departmentId)]);
    if (!dept) return res.status(400).json({ error: 'departmentId does not exist' });
  }
  if (changes.programId != null) {
    const program = await get('SELECT id FROM programs WHERE id = ?', [Number(changes.programId)]);
    if (!program) return res.status(400).json({ error: 'programId does not exist' });
  }

  const results = [];
  for (const rawId of studentIds) {
    const studentId = Number(rawId);
    const student = await get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [studentId]);
    if (!student) { results.push({ studentId, ok: false, error: 'Student not found' }); continue; }
    const oldProfile = await get('SELECT departmentId, programId, studentStatus FROM student_profiles WHERE studentId = ?', [studentId]);
    if (!departmentInScope(req, oldProfile?.departmentId)) { results.push({ studentId, ok: false, error: 'Outside your department scope' }); continue; }
    if (changes.departmentId != null && !departmentInScope(req, Number(changes.departmentId))) {
      results.push({ studentId, ok: false, error: 'Target department is outside your scope' }); continue;
    }

    await run('INSERT OR IGNORE INTO student_profiles (studentId) VALUES (?)', [studentId]);
    const values = cols.map(c => (c.endsWith('Id') ? Number(changes[c]) : changes[c]));
    await run(
      `UPDATE student_profiles SET ${cols.map(c => `${c} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE studentId = ?`,
      [...values, studentId]
    );
    const newProfile = await get('SELECT departmentId, programId, studentStatus FROM student_profiles WHERE studentId = ?', [studentId]);
    await logAudit(req.user, 'bulk-update', 'student_profiles', studentId, { reason, fields: cols }, oldProfile, newProfile);
    results.push({ studentId, ok: true });
  }

  res.json({ updated: results.filter(r => r.ok).length, results });
}));

router.get('/:id/overview', requireAuth, requirePermission('students', 'read'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.id);
  // No role filter here — a role_mismatch row (found by the discovery scan) still has real
  // history worth viewing read-only even after their account's role changed away from student.
  const student = await get(`SELECT id FROM users WHERE id = ?`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const profile = await get('SELECT departmentId, applicationId FROM student_profiles WHERE studentId = ?', [studentId]);
  if (!departmentInScope(req, profile?.departmentId)) return res.status(403).json({ error: 'Forbidden' });

  const application = profile?.applicationId
    ? await get(
        'SELECT id, status, source, personalEmail, decidedAt, createdAt FROM applications WHERE id = ?',
        [profile.applicationId]
      )
    : null;

  const enrollments = await all(
    `SELECT e.id, e.status, e.grade, c.id as courseId, c.code as courseCode, c.name as courseName,
            t.id as termId, t.name as termName
     FROM enrollments e
     JOIN courses c ON c.id = e.courseId
     LEFT JOIN terms t ON t.id = c.termId
     WHERE e.studentId = ? AND e.deletedAt IS NULL
     ORDER BY t.startDate DESC, c.code`,
    [studentId]
  );

  const finance = await studentStatement(studentId, null);

  res.json({ application, enrollments, finance });
}));

module.exports = router;
