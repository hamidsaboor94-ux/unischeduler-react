const express = require('express');
const { all, get, run, logAudit, transaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { canModifyEnrollment } = require('../ownership');
const { evaluateEligibility } = require('../eligibility');

const router = express.Router();

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT e.id as enrollmentId, e.status, e.grade, e.createdAt, c.*
     FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE e.studentId = ? AND e.status NOT IN ('dropped', 'withdrawn') ORDER BY e.createdAt`,
    [req.user.sub]
  );
  res.json(rows);
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const studentId = req.user.role === 'student' ? req.user.sub : req.body.studentId;
  const { courseId, override } = req.body;
  if (!studentId || !courseId) return res.status(400).json({ error: 'studentId and courseId are required' });

  const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const isSelfEnroll = req.user.role === 'student';
  // Self-enrollment (student) is always allowed subject to the eligibility checks below.
  // Enrolling someone else requires Admin or Registrar (see ownership.js) — enrollment write
  // is not an ownership right Faculty have, unlike grades/attendance/materials.
  if (!isSelfEnroll && !(await canModifyEnrollment(req, course))) {
    return res.status(403).json({ error: 'You do not have permission to enroll students in this course.' });
  }

  // eligibility.js is the single source of truth for every eligibility gate (active status,
  // program/department, term offering, already-completed, duplicate/sibling-section, prerequisites,
  // schedule clash, credit cap, financial hold) — see routes/students.js's GET /me/eligible-courses
  // for the read-only catalog view that runs the exact same checks.
  const result = await evaluateEligibility(studentId, courseId);

  if (isSelfEnroll) {
    // Hard block: a student can't wave through their own ineligibility.
    if (!result.eligible) return res.status(409).json({ error: result.reason });
  } else if (!result.eligible && !override) {
    // Staff-initiated enrollment: surface as a warning a Registrar/Admin can confirm past
    // (resubmit with override: true) rather than a hard block. Nothing is enrolled yet.
    return res.status(200).json({
      requiresConfirmation: true, prereqIssues: result.prereqIssues, scheduleClash: result.scheduleClash, blocking: result.blocking,
    });
  }

  // Capacity check + insert wrapped in one transaction so two concurrent enrolls can't both read
  // "under capacity" and both land as 'enrolled', overshooting maxStudents.
  const inserted = await transaction(async () => {
    const enrolledCount = await get(`SELECT COUNT(*) as n FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [courseId]);
    const status = course.maxStudents != null && enrolledCount.n >= course.maxStudents ? 'waitlisted' : 'enrolled';
    return run('INSERT INTO enrollments (studentId, courseId, status) VALUES (?, ?, ?)', [studentId, courseId, status]);
  });
  const row = await get('SELECT * FROM enrollments WHERE id = ?', [inserted.id]);
  if (!isSelfEnroll) {
    const wasOverridden = !!override && !result.eligible;
    await logAudit(req.user, wasOverridden ? 'enroll-student-override' : 'enroll-student', 'enrollments', row.id, {
      studentId: Number(studentId), courseId: course.id, courseCode: course.code, status: row.status,
      ...(wasOverridden ? { overriddenPrereqIssues: result.prereqIssues, overriddenScheduleClash: result.scheduleClash, overriddenBlocking: result.blocking } : {}),
    });
  }
  res.status(201).json(row);
}));

// Soft delete: enrollments are an official academic record, so "removing" one never erases the
// row. Which of two outcomes it becomes is decided purely by the course's term's registration
// deadline, regardless of who performs it:
//  - before terms.registrationClosesAt: a plain 'dropped' — invisible to the transcript/GPA,
//    same as always (see db.js's enrollments.deletedAt comment).
//  - on/after it: a 'withdrawn' — stays on the transcript as "W" (routes/transcript.js) with no
//    GPA impact (computeAcademicSummary only ever counts status='enrolled'), and records
//    withdrawalDate/withdrawalReason. A course with no term/deadline set can only ever be dropped.
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const enrollment = await get('SELECT * FROM enrollments WHERE id = ?', [req.params.id]);
  if (!enrollment) return res.status(404).json({ error: 'Not found' });
  const course = await get('SELECT * FROM courses WHERE id = ?', [enrollment.courseId]);
  if (req.user.role === 'student') {
    if (enrollment.studentId !== req.user.sub) return res.status(403).json({ error: 'Forbidden' });
  } else if (!(await canModifyEnrollment(req, course))) {
    return res.status(403).json({ error: 'You do not have permission to remove students from this course.' });
  }

  const term = course?.termId ? await get('SELECT registrationClosesAt FROM terms WHERE id = ?', [course.termId]) : null;
  const isWithdrawal = !!(term?.registrationClosesAt && new Date() >= new Date(term.registrationClosesAt));
  const now = new Date().toISOString();
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null;
  const newValue = isWithdrawal
    ? { ...enrollment, status: 'withdrawn', deletedAt: now, withdrawalDate: now, withdrawalReason: reason }
    : { ...enrollment, status: 'dropped', deletedAt: now };

  const auditContext = { studentId: enrollment.studentId, courseId: enrollment.courseId, courseCode: course?.code };
  if (req.user.role !== 'student') {
    await logAudit(req.user, isWithdrawal ? 'withdraw-student' : 'remove-enrollment', 'enrollments', enrollment.id, auditContext, enrollment, newValue);
  } else if (isWithdrawal) {
    // Self-drop (pre-deadline) isn't logged, same as before — routine and reversible by
    // re-enrolling. Self-withdrawal is permanent and transcript-visible, so it is.
    await logAudit(req.user, 'withdraw-self', 'enrollments', enrollment.id, auditContext, enrollment, newValue);
  }

  if (isWithdrawal) {
    await run(
      `UPDATE enrollments SET status = 'withdrawn', deletedAt = ?, withdrawalDate = ?, withdrawalReason = ? WHERE id = ?`,
      [now, now, reason, req.params.id]
    );
  } else {
    await run(`UPDATE enrollments SET status = 'dropped', deletedAt = ? WHERE id = ?`, [now, req.params.id]);
  }

  if (enrollment.status === 'enrolled') {
    const nextWaiting = await get(
      `SELECT * FROM enrollments WHERE courseId = ? AND status = 'waitlisted' ORDER BY createdAt LIMIT 1`,
      [enrollment.courseId]
    );
    if (nextWaiting) {
      await run(`UPDATE enrollments SET status = 'enrolled' WHERE id = ?`, [nextWaiting.id]);
    }
  }

  res.status(200).json({ status: isWithdrawal ? 'withdrawn' : 'dropped' });
}));

/**
 * Registrar/Admin bulk enrollment — used by the roster "Enroll students" picker for both a
 * handful of individually-checked students and a whole-semester "select all". A staff override
 * tool, not a student eligibility gate: duplicates and capacity still hard-skip (`skipped`), but
 * a missing prerequisite or a schedule clash only holds a candidate back as a `warning` — the
 * caller resubmits just those ids via `overrideStudentIds` to force them through, which is
 * audit-logged separately from a clean bulk-enroll.
 */
router.post('/bulk', requireAuth, asyncHandler(async (req, res) => {
  const { courseId } = req.body;
  const studentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : null;
  if (!courseId || !studentIds || !studentIds.length) {
    return res.status(400).json({ error: 'courseId and a non-empty studentIds array are required' });
  }
  const overrideIds = new Set(
    (Array.isArray(req.body.overrideStudentIds) ? req.body.overrideStudentIds : []).map(Number)
  );

  const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (!(await canModifyEnrollment(req, course))) {
    return res.status(403).json({ error: 'You do not have permission to enroll students in this course.' });
  }

  const uniqueIds = [...new Set(studentIds.map(Number))].filter(id => Number.isInteger(id));
  let enrolledCount = (await get(
    `SELECT COUNT(*) as n FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [courseId]
  )).n;

  const enrolled = [];
  const skipped = [];
  const warnings = [];
  const overridden = [];

  for (const studentId of uniqueIds) {
    const student = await get(`SELECT id, name FROM users WHERE id = ? AND role = 'student'`, [studentId]);
    if (!student) { skipped.push({ studentId, name: null, reason: 'Not a student account' }); continue; }

    const already = await get(
      `SELECT id FROM enrollments WHERE studentId = ? AND courseId = ? AND status IN ('enrolled', 'waitlisted')`,
      [studentId, courseId]
    );
    if (already) { skipped.push({ studentId, name: student.name, reason: 'Already enrolled' }); continue; }

    if (course.maxStudents != null && enrolledCount >= course.maxStudents) {
      skipped.push({ studentId, name: student.name, reason: 'Course at capacity' });
      continue;
    }

    // Every other gate (prerequisites, schedule clash, program/department/term match, credit
    // cap, financial hold) runs through the same engine POST / uses — 'not a student'/'already
    // enrolled'/'at capacity' stay hard skips above since bulk never waitlists.
    const evalResult = await evaluateEligibility(studentId, courseId);
    const hasIssues = !evalResult.eligible;
    if (hasIssues && !overrideIds.has(studentId)) {
      warnings.push({ studentId, name: student.name, prereqIssues: evalResult.prereqIssues, scheduleClash: evalResult.scheduleClash, blocking: evalResult.blocking });
      continue;
    }

    const result = await run('INSERT INTO enrollments (studentId, courseId, status) VALUES (?, ?, ?)', [studentId, courseId, 'enrolled']);
    enrolledCount += 1;
    enrolled.push({ studentId, name: student.name, enrollmentId: result.id });
    if (hasIssues) overridden.push({ studentId, name: student.name, prereqIssues: evalResult.prereqIssues, scheduleClash: evalResult.scheduleClash, blocking: evalResult.blocking });
  }

  if (enrolled.length) {
    await logAudit(req.user, 'bulk-enroll', 'enrollments', null, {
      courseId: course.id, courseCode: course.code,
      studentIds: enrolled.map(e => e.studentId), count: enrolled.length,
    });
  }
  if (overridden.length) {
    await logAudit(req.user, 'bulk-enroll-override', 'enrollments', null, {
      courseId: course.id, courseCode: course.code, overrides: overridden,
    });
  }

  res.status(201).json({ enrolled, skipped, warnings });
}));

module.exports = router;
