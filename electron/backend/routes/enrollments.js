const express = require('express');
const { all, get, run, logAudit, transaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { canModifyEnrollment } = require('../ownership');
const { evaluateEligibility } = require('../eligibility');
const { hasPermission, getUserRoles } = require('../authz');
const { safeCreateNotification, createBulkNotifications } = require('../notificationTypes');

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
  const { courseId, override, overrideReason } = req.body;
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
  // schedule clash, credit cap, financial hold, registration window) — see routes/students.js's
  // GET /me/eligible-courses for the read-only catalog view that runs the exact same checks.
  // The registration window is only enforced for self-enrollment — Registrar/Admin enrolling a
  // student on staff's behalf can do so any time, same as other staff enrollment actions.
  let curriculumOverride = false;
  if (!isSelfEnroll && override) {
    const roles = await getUserRoles(req.user.sub, req.user.role);
    if (!(await hasPermission(roles, 'curriculum', 'OverrideRegistrationRecommendation'))) {
      return res.status(403).json({ error:'You do not have permission to override curriculum recommendations.' });
    }
    if (!String(overrideReason||'').trim()) return res.status(400).json({ error:'An override reason is required.' });
    curriculumOverride = true;
  }
  const result = await evaluateEligibility(studentId, courseId, {
    enforceRegistrationWindow: isSelfEnroll,
    allowSemesterOverride: curriculumOverride,
  });

  if (isSelfEnroll) {
    // Hard block: a student can't wave through their own ineligibility.
    if (!result.eligible) {
      await safeCreateNotification({recipientUserId:studentId,type:'enrollment_rejected',title:'Registration not completed',message:result.reason,
        severity:'warning',entityType:'course',entityId:Number(courseId),courseId:Number(courseId),actionSection:'catalog',
        actionData:{courseId:Number(courseId)},deduplicationKey:`enrollment-rejected:${studentId}:${courseId}:${result.blocking?.[0]?.code||'blocked'}:${new Date().toISOString().slice(0,10)}`,
        category:'academic_updates'});
      return res.status(409).json({ error: result.reason });
    }
  } else if (!result.eligible) {
    // Staff-initiated enrollment: surface as a warning a Registrar/Admin can confirm past
    // (resubmit with override: true) rather than a hard block. Nothing is enrolled yet.
    return res.status(200).json({
      requiresConfirmation: false, prereqIssues: result.prereqIssues, scheduleClash: result.scheduleClash, blocking: result.blocking,
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
    const wasOverridden = curriculumOverride;
    await logAudit(req.user, wasOverridden ? 'enroll-student-override' : 'enroll-student', 'enrollments', row.id, {
      studentId: Number(studentId), courseId: course.id, courseCode: course.code, status: row.status,
      ...(wasOverridden ? { overrideReason:String(overrideReason).trim(), recommendedSemester:result.curriculum?.recommendedSemester } : {}),
    });
    if (wasOverridden) await run(`INSERT INTO curriculum_registration_overrides(studentId,courseId,curriculumId,reason,approvedBy) VALUES(?,?,?,?,?)`,[studentId,courseId,result.curriculum.curriculumId,String(overrideReason).trim(),req.user.sub]);
  }
  await safeCreateNotification({recipientUserId:Number(studentId),type:row.status==='waitlisted'?'enrollment_waitlisted':'enrollment_succeeded',
    title:row.status==='waitlisted'?'Added to course waitlist':'Course registration confirmed',
    message:row.status==='waitlisted'?`You were added to the waitlist for ${course.code} — ${course.name}.`:`You are enrolled in ${course.code} — ${course.name}.`,
    severity:row.status==='waitlisted'?'warning':'success',entityType:'enrollment',entityId:row.id,courseId:course.id,
    actionSection:'myschedule',deduplicationKey:`enrollment:${row.id}:${row.status}`,createdBy:req.user.sub,category:'academic_updates'});
  if(row.status==='waitlisted'){
    const staff=await all(`SELECT id FROM users WHERE role IN ('registrar','admin')`);
    await createBulkNotifications({recipientUserIds:staff.map(x=>x.id),type:'enrollment_waitlisted',title:'Course waitlist requires attention',
      message:`${course.code} has reached capacity and a student entered the waitlist.`,severity:'warning',entityType:'course',entityId:course.id,
      actionSection:'enrollment',actionData:{courseId:course.id},deduplicationKeyPrefix:`course-waitlist:${course.id}:${row.id}`,createdBy:req.user.sub});
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
      await safeCreateNotification({recipientUserId:nextWaiting.studentId,type:'waitlist_promoted',title:'Waitlist promotion',
        message:`A place opened in ${course.code} — ${course.name}; you are now enrolled.`,severity:'success',entityType:'enrollment',entityId:nextWaiting.id,
        courseId:course.id,actionSection:'myschedule',deduplicationKey:`waitlist-promoted:${nextWaiting.id}`,createdBy:req.user.sub,category:'academic_updates'});
    }
  }

  await safeCreateNotification({recipientUserId:enrollment.studentId,type:'course_dropped',title:isWithdrawal?'Course withdrawal recorded':'Course dropped',
    message:`Your ${isWithdrawal?'withdrawal from':'drop of'} ${course.code} — ${course.name} has been recorded.`,severity:'info',entityType:'enrollment',entityId:enrollment.id,
    courseId:course.id,actionSection:'myschedule',deduplicationKey:`course-drop:${enrollment.id}:${isWithdrawal?'withdrawn':'dropped'}`,createdBy:req.user.sub,category:'academic_updates'});

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
    // enrolled'/'at capacity' stay hard skips above since bulk never waitlists. Registration
    // window is never enforced here — bulk enroll is always staff-initiated.
    const evalResult = await evaluateEligibility(studentId, courseId, { enforceRegistrationWindow: false });
    const hasIssues = !evalResult.eligible;
    if (hasIssues) {
      warnings.push({ studentId, name: student.name, prereqIssues: evalResult.prereqIssues, scheduleClash: evalResult.scheduleClash, blocking: evalResult.blocking });
      continue;
    }

    const result = await run('INSERT INTO enrollments (studentId, courseId, status) VALUES (?, ?, ?)', [studentId, courseId, 'enrolled']);
    enrolledCount += 1;
    enrolled.push({ studentId, name: student.name, enrollmentId: result.id });
    await safeCreateNotification({recipientUserId:studentId,type:'enrollment_succeeded',title:'Course registration confirmed',
      message:`You are enrolled in ${course.code} — ${course.name}.`,severity:'success',entityType:'enrollment',entityId:result.id,courseId:course.id,
      actionSection:'myschedule',deduplicationKey:`enrollment:${result.id}:enrolled`,createdBy:req.user.sub,category:'academic_updates'});
  }

  if (enrolled.length) {
    await logAudit(req.user, 'bulk-enroll', 'enrollments', null, {
      courseId: course.id, courseCode: course.code,
      studentIds: enrolled.map(e => e.studentId), count: enrolled.length,
    });
  }
  res.status(201).json({ enrolled, skipped, warnings });
}));

module.exports = router;
