const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { canModifyEnrollment } = require('../ownership');
const { unmetPrerequisites, hasScheduleClash } = require('../enrollmentChecks');

const router = express.Router();

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT e.id as enrollmentId, e.status, e.grade, e.createdAt, c.*
     FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE e.studentId = ? AND e.status != 'dropped' ORDER BY e.createdAt`,
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

  // Program/department scope: a student may only register within their own department (no
  // program-level entity exists yet to scope by more precisely — see programs table). Fails
  // OPEN when either side's department is unknown: this is a business-rule eligibility gate,
  // not a security boundary, so an incomplete profile/course record must never silently lock a
  // student out of every course.
  if (isSelfEnroll) {
    const profile = await get('SELECT departmentId FROM student_profiles WHERE studentId = ?', [studentId]);
    if (profile?.departmentId != null && course.departmentId != null
        && Number(profile.departmentId) !== Number(course.departmentId)) {
      return res.status(409).json({ error: 'This course is not offered in your department.' });
    }
  }

  const already = await get(
    `SELECT id FROM enrollments WHERE studentId = ? AND courseId = ? AND status IN ('enrolled', 'waitlisted')`,
    [studentId, courseId]
  );
  if (already) return res.status(409).json({ error: 'Already enrolled or waitlisted in this course' });

  // Multiple course rows can share the same name — that's how separate sections of the same
  // class are modeled here (different teacher/room/time per row, see timetableImport.js's
  // course-matching comment). A student picks exactly one section, so block enrolling in a
  // sibling section (same name, same term) while already enrolled/waitlisted in another.
  const siblingSection = await get(
    `SELECT c2.code FROM enrollments e JOIN courses c2 ON c2.id = e.courseId
     WHERE e.studentId = ? AND e.status IN ('enrolled', 'waitlisted') AND e.courseId != ?
       AND c2.termId IS ? AND LOWER(TRIM(c2.name)) = LOWER(TRIM(?))`,
    [studentId, courseId, course.termId ?? null, course.name]
  );
  if (siblingSection) {
    return res.status(409).json({ error: `You're already enrolled in another section of this course (${siblingSection.code}) this term.` });
  }

  // "Enrolled" satisfies a prerequisite while it's still in progress (no grade yet); once a
  // grade is recorded, a failing grade no longer does — see enrollmentChecks.js.
  const prereqIssues = await unmetPrerequisites(studentId, courseId);
  const scheduleClash = await hasScheduleClash(studentId, courseId, course.termId);

  if (isSelfEnroll) {
    // Hard block: a student can't wave through their own missing prerequisite or clash.
    if (prereqIssues.length) return res.status(409).json({ error: `Missing prerequisite: ${prereqIssues.join(', ')}` });
    if (scheduleClash) return res.status(409).json({ error: 'This course conflicts with a time slot already on your schedule' });
  } else if ((prereqIssues.length || scheduleClash) && !override) {
    // Staff-initiated enrollment: surface as a warning a Registrar/Admin can confirm past
    // (resubmit with override: true) rather than a hard block. Nothing is enrolled yet.
    return res.status(200).json({ requiresConfirmation: true, prereqIssues, scheduleClash });
  }

  if (course.termId) {
    const term = await get('SELECT * FROM terms WHERE id = ?', [course.termId]);
    if (term && term.creditLimit != null) {
      const enrolledCourses = await all(
        `SELECT c.credits FROM enrollments e JOIN courses c ON c.id = e.courseId
         WHERE e.studentId = ? AND e.status = 'enrolled' AND c.termId = ?`,
        [studentId, course.termId]
      );
      const currentCredits = enrolledCourses.reduce((sum, r) => sum + (r.credits || 0), 0);
      const newTotal = currentCredits + (course.credits || 0);
      if (newTotal > term.creditLimit) {
        return res.status(409).json({
          error: `This would exceed your ${term.creditLimit}-credit limit for ${term.name} — you currently have ${currentCredits} credits enrolled.`
        });
      }
    }
  }

  const enrolledCount = await get(
    `SELECT COUNT(*) as n FROM enrollments WHERE courseId = ? AND status = 'enrolled'`,
    [courseId]
  );
  const status = course.maxStudents != null && enrolledCount.n >= course.maxStudents ? 'waitlisted' : 'enrolled';
  const result = await run('INSERT INTO enrollments (studentId, courseId, status) VALUES (?, ?, ?)', [studentId, courseId, status]);
  const row = await get('SELECT * FROM enrollments WHERE id = ?', [result.id]);
  if (!isSelfEnroll) {
    const wasOverridden = !!override && (prereqIssues.length > 0 || scheduleClash);
    await logAudit(req.user, wasOverridden ? 'enroll-student-override' : 'enroll-student', 'enrollments', row.id, {
      studentId: Number(studentId), courseId: course.id, courseCode: course.code, status,
      ...(wasOverridden ? { overriddenPrereqIssues: prereqIssues, overriddenScheduleClash: scheduleClash } : {}),
    });
  }
  res.status(201).json(row);
}));

// Soft delete: enrollments are an official academic record, so "removing" one marks it dropped
// + timestamps deletedAt instead of erasing the row — the student's enrollment history (including
// any grade already on it) survives. 'dropped' is already excluded by every read site that
// filters status = 'enrolled' / IN ('enrolled','waitlisted'), so nothing else needed to change.
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const enrollment = await get('SELECT * FROM enrollments WHERE id = ?', [req.params.id]);
  if (!enrollment) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'student') {
    if (enrollment.studentId !== req.user.sub) return res.status(403).json({ error: 'Forbidden' });
  } else {
    const course = await get('SELECT * FROM courses WHERE id = ?', [enrollment.courseId]);
    if (!(await canModifyEnrollment(req, course))) {
      return res.status(403).json({ error: 'You do not have permission to remove students from this course.' });
    }
    await logAudit(
      req.user, 'remove-enrollment', 'enrollments', enrollment.id,
      { studentId: enrollment.studentId, courseId: enrollment.courseId, courseCode: course?.code },
      enrollment, { ...enrollment, status: 'dropped', deletedAt: new Date().toISOString() }
    );
  }

  await run(`UPDATE enrollments SET status = 'dropped', deletedAt = ? WHERE id = ?`, [new Date().toISOString(), req.params.id]);

  if (enrollment.status === 'enrolled') {
    const nextWaiting = await get(
      `SELECT * FROM enrollments WHERE courseId = ? AND status = 'waitlisted' ORDER BY createdAt LIMIT 1`,
      [enrollment.courseId]
    );
    if (nextWaiting) {
      await run(`UPDATE enrollments SET status = 'enrolled' WHERE id = ?`, [nextWaiting.id]);
    }
  }

  res.status(204).end();
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

    const prereqIssues = await unmetPrerequisites(studentId, courseId);
    const scheduleClash = await hasScheduleClash(studentId, courseId, course.termId);
    const hasIssues = prereqIssues.length > 0 || scheduleClash;
    if (hasIssues && !overrideIds.has(studentId)) {
      warnings.push({ studentId, name: student.name, prereqIssues, scheduleClash });
      continue;
    }

    const result = await run('INSERT INTO enrollments (studentId, courseId, status) VALUES (?, ?, ?)', [studentId, courseId, 'enrolled']);
    enrolledCount += 1;
    enrolled.push({ studentId, name: student.name, enrollmentId: result.id });
    if (hasIssues) overridden.push({ studentId, name: student.name, prereqIssues, scheduleClash });
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
