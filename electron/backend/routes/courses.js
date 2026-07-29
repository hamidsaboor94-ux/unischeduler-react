const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { runOrFriendlyError } = require('./crudRouter');
const { isPositiveInt } = require('../validate');
const { canManageCourse, canModifyEnrollment, courseScopeClause } = require('../ownership');
const { isScopedRequest, departmentInScope, resolveScopedDepartment, scopedDepartmentIds } = require('../scope');
// Migrated to the central Module.Action authorization layer (see authz.js) — write routes below
// use requirePermission('courses.Create' | '.Update' | '.Delete') instead of the legacy
// requirePermission('courses', 'write') from middleware/permission.js. Read routes are unchanged
// (still gated at the app.js mount via requireModuleAccess).
const { requirePermission } = require('../authz');

/** Resolves { departmentId } for an existing course by id — used as requirePermission's
    scopeOf so a Dept Head/Dean 403s before the handler runs if the course is outside their
    department, on top of (not instead of) canManageCourse's own scope check below. */
async function courseScopeOf(req) {
  return get('SELECT departmentId FROM courses WHERE id = ?', [req.params.id]);
}

const router = express.Router();
const FIELDS = ['code', 'name', 'departmentId', 'credits', 'teacherId', 'roomId', 'maxStudents', 'termId'];

function validateCourse(body) {
  if (body.credits !== undefined && !isPositiveInt(body.credits)) return 'Credits must be a positive number.';
  if (body.maxStudents !== undefined && !isPositiveInt(body.maxStudents)) return 'Max students must be a positive number.';
  return null;
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.termId) { clauses.push('termId = ?'); params.push(req.query.termId); }
  if (req.query.departmentId) { clauses.push('departmentId = ?'); params.push(req.query.departmentId); }
  // Students browse the full catalog to find courses to enroll in; faculty
  // only ever manage their own assigned classes, so their list is scoped.
  const scope = await courseScopeClause(req);
  if (scope) { clauses.push(scope.clause); params.push(...scope.params); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  // enrolledCount: a read-only aggregate (no student identities), safe for every role that can
  // already read courses at all — powers the student Course Catalog's remaining-seats display.
  const rows = await all(
    `SELECT c.*, (SELECT COUNT(*) FROM enrollments e WHERE e.courseId = c.id AND e.status = 'enrolled') AS enrolledCount
     FROM courses c ${where}`,
    params
  );
  res.json(rows);
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // A department-restricted role can't read a course outside its scope.
  if (isScopedRequest(req) && !departmentInScope(req, row.departmentId)) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (req.user.role === 'faculty' && !(await canManageCourse(req, row))) {
    return res.status(403).json({ error: 'You do not have access to this course.' });
  }
  res.json(row);
}));

router.post('/', requireAuth, requirePermission('courses.Create'), asyncHandler(async (req, res) => {
  if (!req.body.code || !req.body.name) return res.status(400).json({ error: 'Course code and name are required' });
  const validationErr = validateCourse(req.body);
  if (validationErr) return res.status(400).json({ error: validationErr });
  // A department-restricted creator (Department Head / Dean) can only create
  // courses within their own department(s) — resolve/validate against scope.
  if (isScopedRequest(req)) {
    const r = resolveScopedDepartment(req, req.body.departmentId);
    if (r.error) return res.status(403).json({ error: r.error });
    req.body.departmentId = r.departmentId;
  }
  const existing = await get('SELECT id FROM courses WHERE code = ? AND termId IS ?', [req.body.code, req.body.termId ?? null]);
  if (existing) return res.status(409).json({ error: `Course code ${req.body.code} already exists in this term` });
  const cols = FIELDS.filter(f => req.body[f] !== undefined);
  const result = await runOrFriendlyError(res, 'courses', () => run(
    `INSERT INTO courses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map(c => req.body[c])
  ));
  if (result === undefined) return;
  const row = await get('SELECT * FROM courses WHERE id = ?', [result.id]);
  await logAudit(req.user, 'create', 'courses', result.id, req.body, null, row);
  res.status(201).json(row);
}));

router.post('/bulk-import', requireAuth, requirePermission('courses.Create'), asyncHandler(async (req, res) => {
  const { rows, termId } = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided' });
  if (!termId) return res.status(400).json({ error: 'termId is required' });
  // Department-restricted importers may only create within their own
  // department(s); each row's resolved department must fall inside that set.
  const scopedIds = scopedDepartmentIds(req);

  const departments = await all('SELECT id, name FROM departments');
  const teachers = await all('SELECT id, name FROM teachers');
  const rooms = await all('SELECT id, name FROM rooms');
  const byName = (list) => new Map(list.map(x => [x.name.trim().toLowerCase(), x.id]));
  const deptByName = byName(departments);
  const teacherByName = byName(teachers);
  const roomByName = byName(rooms);

  const created = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    if (!r.code || !r.name) { errors.push({ row: rowNum, error: 'Code and name are required' }); continue; }
    if (!r.department) { errors.push({ row: rowNum, error: 'Department is required' }); continue; }
    const departmentId = deptByName.get(String(r.department).trim().toLowerCase());
    if (!departmentId) { errors.push({ row: rowNum, error: `Unknown department "${r.department}"` }); continue; }
    if (scopedIds !== null && !scopedIds.includes(Number(departmentId))) { errors.push({ row: rowNum, error: `Department "${r.department}" is outside your scope` }); continue; }
    const credits = Number(r.credits);
    if (!isPositiveInt(credits)) { errors.push({ row: rowNum, error: 'Credits must be a positive number' }); continue; }
    const teacherId = r.instructor ? teacherByName.get(String(r.instructor).trim().toLowerCase()) : undefined;
    if (r.instructor && !teacherId) { errors.push({ row: rowNum, error: `Unknown instructor "${r.instructor}"` }); continue; }
    const roomId = r.room ? roomByName.get(String(r.room).trim().toLowerCase()) : undefined;
    if (r.room && !roomId) { errors.push({ row: rowNum, error: `Unknown room "${r.room}"` }); continue; }
    const maxStudents = r.maxStudents !== undefined && r.maxStudents !== '' ? Number(r.maxStudents) : undefined;
    if (maxStudents !== undefined && !isPositiveInt(maxStudents)) { errors.push({ row: rowNum, error: 'Max students must be a positive number' }); continue; }
    const existing = await get('SELECT id FROM courses WHERE code = ? AND termId IS ?', [r.code, termId]);
    if (existing) { errors.push({ row: rowNum, error: `Course code ${r.code} already exists in this term` }); continue; }

    const cols = ['code', 'name', 'departmentId', 'credits', 'termId'];
    const vals = [r.code, r.name, departmentId, credits, termId];
    if (teacherId) { cols.push('teacherId'); vals.push(teacherId); }
    if (roomId) { cols.push('roomId'); vals.push(roomId); }
    if (maxStudents !== undefined) { cols.push('maxStudents'); vals.push(maxStudents); }
    const result = await run(`INSERT INTO courses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
    created.push({ row: rowNum, id: result.id, code: r.code });
  }
  if (created.length) await logAudit(req.user, 'bulk-import', 'courses', null, { count: created.length, codes: created.map(c => c.code) });
  res.status(200).json({ created, errors });
}));

// Editing course metadata (code/name/department/credits/instructor/room/capacity) is a
// registrar/admin-level action, not a faculty ownership right — faculty keep courses:View only,
// so requirePermission('courses.Update') rejects them here even though canManageCourse's
// ownership branch would otherwise let a faculty member manage their own assigned course
// (that ownership path stays deliberately in effect for teaching actions elsewhere:
// announcements/assignments/attendance/grades/materials/roster).
router.put('/:id', requireAuth, requirePermission('courses.Update', { scopeOf: courseScopeOf }), asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!(await canManageCourse(req, existing))) return res.status(403).json({ error: 'You do not have access to this course.' });
  // A department-restricted editor can't move a course into another department.
  if (isScopedRequest(req)) req.body.departmentId = existing.departmentId;
  const cols = FIELDS.filter(f => req.body[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  const validationErr = validateCourse(req.body);
  if (validationErr) return res.status(400).json({ error: validationErr });
  if (cols.includes('code')) {
    const current = await get('SELECT termId FROM courses WHERE id = ?', [req.params.id]);
    const effectiveTermId = cols.includes('termId') ? req.body.termId : current?.termId;
    const clash = await get('SELECT id FROM courses WHERE code = ? AND termId IS ? AND id != ?', [req.body.code, effectiveTermId ?? null, req.params.id]);
    if (clash) return res.status(409).json({ error: `Course code ${req.body.code} already exists in this term` });
  }
  const result = await runOrFriendlyError(res, 'courses', () => run(
    `UPDATE courses SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map(c => req.body[c]), req.params.id]
  ));
  if (result === undefined) return;
  const row = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user, 'update', 'courses', req.params.id, req.body, existing, row);
  res.json(row);
}));

// Deleting a course is a staff action (admin/registrar/dept head) — faculty who
// can edit their own course still can't delete it. requirePermission('courses.Delete')
// excludes faculty (courses:View only); the dept-scope check below then confines a
// Department Head to their own department.
router.delete('/:id', requireAuth, requirePermission('courses.Delete', { scopeOf: courseScopeOf }), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const course = await get('SELECT * FROM courses WHERE id = ?', [id]);
  if (!course) return res.status(404).json({ error: 'Not found' });
  if (!(await canManageCourse(req, course))) return res.status(403).json({ error: 'You do not have access to this course.' });
  await run('DELETE FROM course_prerequisites WHERE courseId = ? OR prerequisiteCourseId = ?', [id, id]);
  await run('DELETE FROM timetable_slots WHERE courseId = ?', [id]);
  await run('DELETE FROM exams WHERE courseId = ?', [id]);
  await run('DELETE FROM enrollments WHERE courseId = ?', [id]);
  await run('DELETE FROM courses WHERE id = ?', [id]);
  await logAudit(req.user, 'delete', 'courses', id, null, course, null);
  res.status(204).end();
}));

router.get('/:id/prerequisites', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT c.* FROM course_prerequisites cp JOIN courses c ON c.id = cp.prerequisiteCourseId WHERE cp.courseId = ?`,
    [req.params.id]
  );
  res.json(rows);
}));

/** Meeting schedule (day/time/room) for one course — any authenticated role, no ownership check.
    Unlike GET /slots (scoped to the caller's own enrolled/owned courses for the Timetable and My
    Schedule views), a student browsing the Catalog needs to see the schedule of a course they
    are NOT yet enrolled in to decide whether to register — the same read-only, non-sensitive
    data (day/time/room), just reachable for a course the caller hasn't joined yet. */
router.get('/:id/slots', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT id, courseId, day, time, durationMinutes, roomId FROM timetable_slots WHERE courseId = ?',
    [req.params.id]
  );
  res.json(rows);
}));

// Same as PUT /:id: prerequisites are course metadata, so this is registrar/admin-level,
// not covered by faculty course ownership.
router.post('/:id/prerequisites', requireAuth, requirePermission('courses.Update', { scopeOf: courseScopeOf }), asyncHandler(async (req, res) => {
  const course = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!course) return res.status(404).json({ error: 'Not found' });
  if (!(await canManageCourse(req, course))) return res.status(403).json({ error: 'You do not have access to this course.' });
  const { prerequisiteCourseId } = req.body;
  if (!prerequisiteCourseId) return res.status(400).json({ error: 'prerequisiteCourseId required' });
  if (Number(prerequisiteCourseId) === Number(req.params.id)) {
    return res.status(400).json({ error: 'A course cannot be its own prerequisite' });
  }
  await run(
    'INSERT INTO course_prerequisites (courseId, prerequisiteCourseId) VALUES (?, ?) ON CONFLICT (courseId, prerequisiteCourseId) DO NOTHING',
    [req.params.id, prerequisiteCourseId]
  );
  res.status(201).json({ courseId: Number(req.params.id), prerequisiteCourseId: Number(prerequisiteCourseId) });
}));

router.delete('/:id/prerequisites/:prereqId', requireAuth, requirePermission('courses.Update', { scopeOf: courseScopeOf }), asyncHandler(async (req, res) => {
  const course = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!course) return res.status(404).json({ error: 'Not found' });
  if (!(await canManageCourse(req, course))) return res.status(403).json({ error: 'You do not have access to this course.' });
  await run(
    'DELETE FROM course_prerequisites WHERE courseId = ? AND prerequisiteCourseId = ?',
    [req.params.id, req.params.prereqId]
  );
  res.status(204).end();
}));

router.get('/:id/roster', requireAuth, asyncHandler(async (req, res) => {
  const course = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!course) return res.status(404).json({ error: 'Not found' });
  if (!(await canManageCourse(req, course))) return res.status(403).json({ error: 'You do not have access to this course.' });
  const rows = await all(
    `SELECT e.id as enrollmentId, e.status, e.grade, e.createdAt, u.id as studentId, u.name, u.email, u.idNumber
     FROM enrollments e JOIN users u ON u.id = e.studentId
     WHERE e.courseId = ? AND e.status != 'dropped' ORDER BY e.createdAt`,
    [req.params.id]
  );
  res.json(rows);
}));

// Candidates for the roster's "Enroll students" picker: students scoped to the course's
// department (no program-level link exists on courses yet), each flagged with their current
// enrollment status in this course so the UI can hide/disable already-enrolled students. Fails
// OPEN on an unset student department, same as the self-enroll department check in
// routes/enrollments.js — an incomplete profile shouldn't silently vanish from every picker.
router.get('/:id/eligible-students', requireAuth, asyncHandler(async (req, res) => {
  const course = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!course) return res.status(404).json({ error: 'Not found' });
  if (!(await canModifyEnrollment(req, course))) {
    return res.status(403).json({ error: 'You do not have permission to view enrollment candidates for this course.' });
  }
  const clauses = [`u.role = 'student'`];
  const params = [];
  if (course.departmentId != null) {
    clauses.push('(sp.departmentId IS NULL OR sp.departmentId = ?)');
    params.push(course.departmentId);
  }
  const rows = await all(
    `SELECT u.id, u.name, u.email, u.idNumber, sp.departmentId, sp.programSemester,
            e.status as enrollmentStatus
     FROM users u
     LEFT JOIN student_profiles sp ON sp.studentId = u.id
     LEFT JOIN enrollments e ON e.studentId = u.id AND e.courseId = ? AND e.status IN ('enrolled', 'waitlisted')
     WHERE ${clauses.join(' AND ')}
     ORDER BY sp.programSemester, u.name`,
    [req.params.id, ...params]
  );
  res.json(rows);
}));

module.exports = router;
