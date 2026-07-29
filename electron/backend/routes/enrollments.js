const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { overlapsMinutes } = require('../scheduling');
const { canManageCourse } = require('../ownership');

const router = express.Router();

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT e.id as enrollmentId, e.status, e.grade, e.createdAt, c.*
     FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE e.studentId = ? ORDER BY e.createdAt`,
    [req.user.sub]
  );
  res.json(rows);
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const studentId = req.user.role === 'student' ? req.user.sub : req.body.studentId;
  const { courseId } = req.body;
  if (!studentId || !courseId) return res.status(400).json({ error: 'studentId and courseId are required' });

  const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (req.user.role === 'faculty' && !(await canManageCourse(req, course))) {
    return res.status(403).json({ error: 'You can only manage enrollment for your own courses.' });
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

  const prereqs = await all('SELECT prerequisiteCourseId FROM course_prerequisites WHERE courseId = ?', [courseId]);
  for (const p of prereqs) {
    // "Enrolled" satisfies the prerequisite while it's still in progress (no
    // grade yet); once a grade is recorded, a failing grade no longer does.
    const completed = await get(
      `SELECT id FROM enrollments WHERE studentId = ? AND courseId = ? AND status = 'enrolled' AND (grade IS NULL OR grade != 'F')`,
      [studentId, p.prerequisiteCourseId]
    );
    if (!completed) {
      const prereqCourse = await get('SELECT code FROM courses WHERE id = ?', [p.prerequisiteCourseId]);
      return res.status(409).json({ error: `Missing prerequisite: ${prereqCourse ? prereqCourse.code : p.prerequisiteCourseId}` });
    }
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

  const targetSlots = await all('SELECT * FROM timetable_slots WHERE courseId = ?', [courseId]);
  if (targetSlots.length) {
    const existingSlots = await all(
      `SELECT ts.* FROM timetable_slots ts
       JOIN enrollments e ON e.courseId = ts.courseId
       WHERE e.studentId = ? AND e.status = 'enrolled' AND ts.termId IS ?`,
      [studentId, course.termId]
    );
    const clash = targetSlots.some(ts => existingSlots.some(es =>
      es.day === ts.day && overlapsMinutes(es.time, es.durationMinutes || 60, ts.time, ts.durationMinutes || 60)));
    if (clash) return res.status(409).json({ error: 'This course conflicts with a time slot already on your schedule' });
  }

  const enrolledCount = await get(
    `SELECT COUNT(*) as n FROM enrollments WHERE courseId = ? AND status = 'enrolled'`,
    [courseId]
  );
  const status = course.maxStudents != null && enrolledCount.n >= course.maxStudents ? 'waitlisted' : 'enrolled';
  const result = await run('INSERT INTO enrollments (studentId, courseId, status) VALUES (?, ?, ?)', [studentId, courseId, status]);
  const row = await get('SELECT * FROM enrollments WHERE id = ?', [result.id]);
  res.status(201).json(row);
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const enrollment = await get('SELECT * FROM enrollments WHERE id = ?', [req.params.id]);
  if (!enrollment) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'student' && enrollment.studentId !== req.user.sub) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await run('DELETE FROM enrollments WHERE id = ?', [req.params.id]);

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

module.exports = router;
