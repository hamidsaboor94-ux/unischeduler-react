const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { canManageCourse } = require('../ownership');
const { safeCreateNotification, createBulkNotifications } = require('../notificationTypes');

const router = express.Router();
const VALID_STATUSES = ['present', 'absent', 'late'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A student's own attendance across every course they're enrolled in — this must be
// registered before '/:courseId'-shaped routes below aren't a concern here since we
// use a query param, but keeping /me first mirrors the convention used by enrollments.js.
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT a.id, a.date, a.status, a.slotId, c.id as courseId, c.code, c.name
     FROM attendance a JOIN courses c ON c.id = a.courseId
     WHERE a.studentId = ? ORDER BY a.date DESC, c.code`,
    [req.user.sub]
  );
  res.json(rows);
}));

// Full attendance history for one course — admin any course, faculty only their own.
// Used both to render the history view and to prefill an in-progress session's form.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  // A student's own attendance is at /me; they can't read a whole course here.
  // Viewer (auditor) and admin read any course; faculty only their own.
  if (req.user.role === 'student') return res.status(403).json({ error: 'Forbidden' });
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId is required' });
  const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (req.user.role === 'faculty' && !(await canManageCourse(req, course))) {
    return res.status(403).json({ error: 'You do not have access to this course.' });
  }

  const rows = await all(
    `SELECT a.*, u.name as studentName, u.idNumber as studentIdNumber
     FROM attendance a JOIN users u ON u.id = a.studentId
     WHERE a.courseId = ? ORDER BY a.date DESC, u.name`,
    [courseId]
  );
  res.json(rows);
}));

// Submits a whole session's attendance at once — one row per enrolled student.
// Resubmitting the same slot+date corrects it (each student's row is upserted,
// not duplicated), so a teacher can safely reopen and fix a mistake later.
router.post('/bulk', requireAuth, requireRole('admin', 'faculty'), asyncHandler(async (req, res) => {
  const { slotId, date, entries } = req.body;
  if (!ISO_DATE_RE.test(date || '')) return res.status(400).json({ error: 'A date (YYYY-MM-DD) is required' });
  if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'No attendance entries provided' });
  if (entries.some(e => !VALID_STATUSES.includes(e.status))) {
    return res.status(400).json({ error: `Status must be one of ${VALID_STATUSES.join(', ')}` });
  }

  const slot = await get('SELECT * FROM timetable_slots WHERE id = ?', [slotId]);
  if (!slot) return res.status(404).json({ error: 'Timetable slot not found' });
  const course = await get('SELECT * FROM courses WHERE id = ?', [slot.courseId]);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (req.user.role === 'faculty' && !(await canManageCourse(req, course))) {
    return res.status(403).json({ error: 'You do not have access to this course.' });
  }

  const warningSetting = await get("SELECT value FROM settings WHERE key = 'attendanceWarningThreshold'");
  const examSetting = await get("SELECT value FROM settings WHERE key = 'attendanceExamThreshold'");
  const warningThreshold = Number(warningSetting?.value || 75);
  const examThreshold = Number(examSetting?.value || 60);
  const beforeByStudent = new Map();
  const existingByStudent = new Map();
  for (const entry of entries) {
    const stats = await get(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) attended
       FROM attendance WHERE courseId = ? AND studentId = ?`,
      [course.id, entry.studentId]
    );
    const priorPercentage = stats.total ? Number(stats.attended || 0) / stats.total * 100 : 100;
    beforeByStudent.set(Number(entry.studentId), priorPercentage);
    existingByStudent.set(Number(entry.studentId), Boolean(await get(
      'SELECT id FROM attendance WHERE slotId = ? AND studentId = ? AND date = ?',
      [slotId, entry.studentId, date]
    )));
  }

  for (const e of entries) {
    const existing = await get(
      'SELECT id FROM attendance WHERE slotId = ? AND studentId = ? AND date = ?',
      [slotId, e.studentId, date]
    );
    if (existing) {
      await run('UPDATE attendance SET status = ?, markedBy = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [e.status, req.user.sub, existing.id]);
    } else {
      await run(
        'INSERT INTO attendance (slotId, courseId, studentId, date, status, markedBy) VALUES (?, ?, ?, ?, ?, ?)',
        [slotId, course.id, e.studentId, date, e.status, req.user.sub]
      );
    }
  }
  await logAudit(req.user, 'mark-attendance', 'attendance', null, { courseId: course.id, slotId, date, count: entries.length });

  const rows = await all(
    `SELECT a.*, u.name as studentName FROM attendance a JOIN users u ON u.id = a.studentId WHERE a.slotId = ? AND a.date = ?`,
    [slotId, date]
  );
  for (const entry of entries) {
    const studentId = Number(entry.studentId);
    const corrected = existingByStudent.get(studentId);
    const attendanceRow = rows.find(row => Number(row.studentId) === studentId);
    await safeCreateNotification({
      recipientUserId: studentId,
      type: corrected ? 'attendance_corrected' : 'attendance_posted',
      title: corrected ? 'Attendance corrected' : 'Attendance posted',
      message: `Attendance for ${course.code} on ${date}: ${entry.status}.`,
      severity: entry.status === 'absent' ? 'warning' : 'info',
      entityType: 'attendance',
      entityId: attendanceRow?.id,
      courseId: course.id,
      actionSection: 'my-attendance',
      deduplicationKey: `attendance:${slotId}:${studentId}:${date}:${entry.status}`,
      createdBy: req.user.sub,
      category: 'academic_updates'
    });

    const after = await get(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) attended
       FROM attendance WHERE courseId = ? AND studentId = ?`,
      [course.id, studentId]
    );
    const percentage = after.total ? Number(after.attended || 0) / after.total * 100 : 100;
    const previousPercentage = beforeByStudent.get(studentId);
    const crossedThreshold = percentage < examThreshold
      ? examThreshold
      : percentage < warningThreshold ? warningThreshold : null;

    if (crossedThreshold !== null && previousPercentage >= crossedThreshold) {
      const critical = percentage < examThreshold;
      const type = critical ? 'attendance_exam_block' : 'attendance_warning';
      await safeCreateNotification({
        recipientUserId: studentId,
        type,
        title: critical ? 'Attendance may affect exam eligibility' : 'Attendance warning',
        message: `Your attendance in ${course.code} is ${Math.round(percentage)}%. Please review your attendance record.`,
        severity: critical ? 'critical' : 'warning',
        entityType: 'course',
        entityId: course.id,
        courseId: course.id,
        actionSection: 'my-attendance',
        deduplicationKey: `attendance-threshold:${course.id}:${studentId}:${crossedThreshold}:${date}`,
        category: 'academic_updates'
      });
      const staff = await all(
        `SELECT DISTINCT u.id FROM users u
         LEFT JOIN teachers t ON t.userId = u.id
         LEFT JOIN student_profiles sp ON sp.advisorTeacherId = t.id
         WHERE (sp.studentId = ? AND u.id IS NOT NULL)
            OR (u.role = 'dept_head' AND u.departmentId = ?)`,
        [studentId, course.departmentId]
      );
      await createBulkNotifications({
        recipientUserIds: staff.map(row => row.id),
        type: 'attendance_at_risk',
        title: 'Student attendance risk',
        message: `A student crossed the ${crossedThreshold}% attendance threshold in ${course.code}.`,
        severity: critical ? 'critical' : 'warning',
        entityType: 'course',
        entityId: course.id,
        actionSection: 'attendance',
        actionData: { courseId: course.id },
        deduplicationKeyPrefix: `attendance-risk:${course.id}:${studentId}:${crossedThreshold}:${date}`
      });
    }
  }
  res.json(rows);
}));

module.exports = router;
