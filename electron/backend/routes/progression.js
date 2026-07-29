const express = require('express');
const { get } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../authz');
const asyncHandler = require('../middleware/asyncHandler');
const { teacherIdForUser } = require('../ownership');
const {
  ensureOpenRecord, getHistory, termCourseRows,
  evaluateStudentProgression, evaluateTerm, manualOverride,
} = require('../academicProgression');
const { computeAcademicSummary } = require('../academicSummary');

const router = express.Router();

/** Same access rule as the Student Profile itself (routes/studentProfile.js): the student's own
    record, an admin, or the advisor assigned to them. A student's academic progression history
    is part of their profile, so read access mirrors it exactly. */
async function canAccessAsync(req, studentId) {
  if (req.user.role === 'admin' || Number(req.user.sub) === Number(studentId)) return true;
  if (req.user.role === 'advisor') {
    const teacherId = await teacherIdForUser(req.user.sub);
    if (teacherId == null) return false;
    const profile = await get('SELECT advisorTeacherId FROM student_profiles WHERE studentId = ?', [studentId]);
    return !!profile && Number(profile.advisorTeacherId) === Number(teacherId);
  }
  return false;
}

router.get('/:studentId/history', requireAuth, asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!(await canAccessAsync(req, studentId))) return res.status(403).json({ error: 'Forbidden' });
  // A brand-new student has no semester_records row yet until something touches it —
  // ensureOpenRecord (idempotent) guarantees "starts in Semester 1" is true from the very first
  // time anyone looks, not only after the first evaluate/override call.
  await ensureOpenRecord(studentId);
  res.json(await getHistory(studentId));
}));

/** The open (current) semester: its record row plus a live in-progress snapshot of the term's
    courses/grades so the UI can show "Credits: 9 of 15 graded" before a final evaluation runs. */
router.get('/:studentId/current', requireAuth, asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!(await canAccessAsync(req, studentId))) return res.status(403).json({ error: 'Forbidden' });
  const record = await ensureOpenRecord(studentId);
  const courses = record ? await termCourseRows(studentId, record.termId) : [];
  const cumulative = await computeAcademicSummary(studentId);
  const term = record?.termId ? await get('SELECT id, name FROM terms WHERE id = ?', [record.termId]) : null;
  res.json({
    record: record || null,
    term,
    courses,
    creditsAttempted: courses.reduce((sum, c) => sum + (c.credits || 0), 0),
    creditsEarned: courses.filter(c => c.grade && c.grade !== 'F').reduce((sum, c) => sum + (c.credits || 0), 0),
    gradedCount: courses.filter(c => c.grade != null).length,
    totalCount: courses.length,
    cgpa: cumulative.gpa,
  });
}));

router.post('/:studentId/evaluate', requireAuth, requirePermission('students.Progress'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  const student = await get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json(await evaluateStudentProgression(studentId, req.user));
}));

router.post('/:studentId/override', requireAuth, requirePermission('students.Progress'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  const student = await get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const { semesterNumber, status, reason, notes } = req.body;
  try {
    const profile = await manualOverride(studentId, { semesterNumber, status, reason, notes }, req.user);
    res.json(profile);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

/** Bulk end-of-term sweep — evaluates every student whose open semester is tied to this term. */
router.post('/evaluate-term/:termId', requireAuth, requirePermission('students.Progress'), asyncHandler(async (req, res) => {
  const termId = Number(req.params.termId);
  const term = await get('SELECT id FROM terms WHERE id = ?', [termId]);
  if (!term) return res.status(404).json({ error: 'Term not found' });
  const results = await evaluateTerm(termId, req.user);
  res.json({
    evaluated: results.length,
    advanced: results.filter(r => r.advanced).length,
    awaitingResults: results.filter(r => r.status === 'Awaiting Results').length,
    failed: results.filter(r => r.status === 'Failed').length,
    graduationEligible: results.filter(r => r.graduationEligible).length,
    results,
  });
}));

module.exports = router;
