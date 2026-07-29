const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { loadTermData } = require('../loaders');
const { autoScheduleAll } = require('../scheduling');
const { candidateDates } = require('../dateUtils');
const { runOrFriendlyError } = require('./crudRouter');
const { canManageExam, isInvigilator, courseScopeClause, enrolledCourseIds, teacherIdForUser } = require('../ownership');
const { courseInScope, isScopedRequest } = require('../scope');
const { requirePermission } = require('../middleware/permission');
const { hasFinancialHold } = require('../finance');

const router = express.Router();
const FIELDS = ['courseId', 'date', 'time', 'durationMinutes', 'roomId', 'invigilatorId', 'termId', 'type'];
const EXAM_TYPES = ['quiz', 'midterm', 'final'];

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.termId) { clauses.push('termId = ?'); params.push(req.query.termId); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await all(`SELECT * FROM exams ${where}`, params);
  res.json(await scopeExamsForUser(req, rows));
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM exams WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'faculty' && !(await canManageExam(req, row)) && !(await isInvigilator(req, row))) {
    return res.status(403).json({ error: 'You do not have access to this exam.' });
  }
  if (req.user.role === 'student') {
    if (!(await enrolledCourseIds(req.user.sub)).includes(row.courseId)) {
      return res.status(403).json({ error: 'You do not have access to this exam.' });
    }
    // Financial hold: an unpaid balance blocks access to midterm & final exams.
    if ((row.type === 'midterm' || row.type === 'final') && await hasFinancialHold(req.user.sub)) {
      return res.status(403).json({ error: 'This exam is blocked by an outstanding fee balance. Please clear your balance to access it.', code: 'FINANCIAL_HOLD' });
    }
  }
  // A department-scoped role can't read another department's exam.
  if (isScopedRequest(req) && !(await courseInScope(req, row.courseId))) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(row);
}));

/** Restricts an exam list to what the caller may see: students → enrolled
 *  courses; faculty → own courses plus exams they invigilate; a Department Head
 *  → their department; admin/registrar/exam officer/viewer → everything. */
async function scopeExamsForUser(req, rows) {
  if (req.user.role === 'student') {
    const myCourseIds = new Set(await enrolledCourseIds(req.user.sub));
    const mine = rows.filter(e => myCourseIds.has(e.courseId));
    // Financial hold: withhold midterm & final exam details and mark them
    // blocked, so a student with an unpaid balance can't sit them.
    if (!(await hasFinancialHold(req.user.sub))) return mine;
    return mine.map(e => (e.type === 'midterm' || e.type === 'final')
      ? { id: e.id, courseId: e.courseId, type: e.type, termId: e.termId, blocked: true }
      : e);
  }
  const scope = await courseScopeClause(req);
  if (!scope) return rows; // admin, registrar, exam officer, viewer
  const scopedCourseIds = new Set((await all(`SELECT id FROM courses WHERE ${scope.clause}`, scope.params)).map(c => c.id));
  if (req.user.role === 'faculty') {
    const teacherId = await teacherIdForUser(req.user.sub);
    return rows.filter(e => scopedCourseIds.has(e.courseId) || (teacherId != null && e.invigilatorId === teacherId));
  }
  return rows.filter(e => scopedCourseIds.has(e.courseId));
}

router.post('/', requireAuth, requirePermission('exams', 'write'), asyncHandler(async (req, res) => {
  // Department-scoped roles may only create exams for their own courses.
  if (isScopedRequest(req) && !(await courseInScope(req, req.body.courseId))) {
    return res.status(403).json({ error: 'You can only manage exams for courses in your own department.' });
  }
  const cols = FIELDS.filter(f => req.body[f] !== undefined);
  const result = await runOrFriendlyError(res, 'exams', () => run(
    `INSERT INTO exams (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map(c => req.body[c])
  ));
  if (result === undefined) return;
  const row = await get('SELECT * FROM exams WHERE id = ?', [result.id]);
  await logAudit(req.user, 'create', 'exams', result.id, req.body);
  res.status(201).json(row);
}));

// Editing exam metadata (date/time/room/invigilator/type) is a registrar/exam-officer/admin-level
// action, not a faculty ownership right — faculty keep exams:R, so requirePermission('exams',
// 'write') rejects them here even though canManageExam's ownership branch (via canManageCourse)
// would otherwise let a faculty member manage their own course's exam.
router.put('/:id', requireAuth, requirePermission('exams', 'write'), asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM exams WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!(await canManageExam(req, existing))) return res.status(403).json({ error: 'You do not have access to this exam.' });
  const cols = FIELDS.filter(f => req.body[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  const result = await runOrFriendlyError(res, 'exams', () => run(
    `UPDATE exams SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map(c => req.body[c]), req.params.id]
  ));
  if (result === undefined) return;
  const row = await get('SELECT * FROM exams WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user, 'update', 'exams', req.params.id, req.body);
  res.json(row);
}));

// Deleting an exam is a staff action — faculty who can edit their own course's
// exam still can't delete it (exams read-only for faculty at module level).
router.delete('/:id', requireAuth, requirePermission('exams', 'write'), asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM exams WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!(await canManageExam(req, existing))) return res.status(403).json({ error: 'You do not have access to this exam.' });
  await run('DELETE FROM exams WHERE id = ?', [req.params.id]);
  await logAudit(req.user, 'delete', 'exams', req.params.id, null);
  res.status(204).end();
}));

router.post('/auto-schedule', requireAuth, requirePermission('exams', 'write'), asyncHandler(async (req, res) => {
  // Auto-scheduling spans every course in the term across all departments, so
  // it's not available to a department-scoped role.
  if (isScopedRequest(req)) {
    return res.status(403).json({ error: 'Auto-scheduling runs across all departments and is not available to a department-scoped role.' });
  }
  const termId = req.body.termId || req.query.termId;
  if (!termId) return res.status(400).json({ error: 'termId is required — select a semester first.' });
  const term = await get('SELECT * FROM terms WHERE id = ?', [termId]);
  if (!term) return res.status(404).json({ error: 'Term not found' });
  // examType is optional (the Dashboard's shortcut button omits it, keeping its old any-type
  // behavior); when given, both the row-creation step and the scheduling pass below are scoped
  // to just that type — a course can end up with a Midterm exam AND a separate Final exam, each
  // generated by its own run, rather than one generic exam per course.
  const examType = req.body.examType || null;
  if (examType && !EXAM_TYPES.includes(examType)) return res.status(400).json({ error: `Invalid exam type: ${examType}` });

  // Every course in this term needs an exam (of this type) eventually — create a placeholder row
  // (unscheduled) for any course that doesn't have one yet of the requested type, so the
  // scheduling pass below actually considers it instead of silently ignoring it.
  const courses = await all('SELECT id, code, name FROM courses WHERE termId = ?', [termId]);
  const courseIds = courses.map(c => c.id);
  const existingExamCourseIds = new Set();
  if (courseIds.length) {
    const placeholders = courseIds.map(() => '?').join(',');
    const rows = examType
      ? await all(`SELECT courseId FROM exams WHERE courseId IN (${placeholders}) AND type = ?`, [...courseIds, examType])
      : await all(`SELECT courseId FROM exams WHERE courseId IN (${placeholders})`, courseIds);
    rows.forEach(r => existingExamCourseIds.add(r.courseId));
  }
  let created = 0;
  for (const c of courses) {
    if (existingExamCourseIds.has(c.id)) continue;
    await run('INSERT INTO exams (courseId, termId, type) VALUES (?, ?, ?)', [c.id, termId, examType || 'final']);
    created++;
  }

  const data = await loadTermData(termId);
  const dateOptions = candidateDates(term);
  const { updates, unresolved } = autoScheduleAll({ ...data, dateOptions, examType });
  for (const u of updates) {
    await run('UPDATE exams SET date = ?, time = ?, roomId = ?, invigilatorId = ? WHERE id = ?', [u.date, u.time, u.roomId, u.invigilatorId, u.examId]);
  }
  // Getting a date/time/room is "scheduled" (matches the page's own scheduled-count definition),
  // but an exam placed without a free invigilator still needs a human to assign one manually —
  // surface that separately from `unresolved` (which is for exams that couldn't be placed at all).
  const needsInvigilator = updates.filter(u => u.invigilatorId == null);
  await logAudit(req.user, 'auto-schedule', 'exams', termId, { examType, created, scheduled: updates.length, unresolved: unresolved.length, needsInvigilator: needsInvigilator.length });

  const courseById = new Map(courses.map(c => [c.id, c]));
  const withCourse = (u) => ({ ...u, courseCode: courseById.get(u.courseId)?.code, courseName: courseById.get(u.courseId)?.name });
  const examCourseId = new Map(data.exams.map(e => [e.id, e.courseId]));
  res.json({
    examType, created, scheduled: updates.length, updates,
    unresolved: unresolved.map(withCourse),
    needsInvigilator: needsInvigilator.map(u => withCourse({ examId: u.examId, courseId: examCourseId.get(u.examId) }))
  });
}));

module.exports = router;
