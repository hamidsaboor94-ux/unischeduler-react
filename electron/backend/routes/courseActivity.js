const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Which of the student's enrolled courses have an assignment or announcement posted since
// they last opened that course's activity card. A missing course_activity_reads row (never
// opened) always counts as unviewed.
router.get('/status', requireAuth, requireRole('student'), asyncHandler(async (req, res) => {
  const courses = await all(`SELECT DISTINCT courseId FROM enrollments WHERE studentId = ? AND status = 'enrolled'`, [req.user.sub]);
  const courseIds = [];
  for (const { courseId } of courses) {
    const lastActivity = await get(
      `SELECT MAX(t) as latest FROM (
         SELECT MAX(createdAt) as t FROM assignments WHERE courseId = ?
         UNION ALL SELECT MAX(createdAt) as t FROM announcements WHERE courseId = ?
       )`,
      [courseId, courseId]
    );
    if (!lastActivity?.latest) continue;
    const read = await get('SELECT lastViewedAt FROM course_activity_reads WHERE studentId = ? AND courseId = ?', [req.user.sub, courseId]);
    if (!read || lastActivity.latest > read.lastViewedAt) courseIds.push(courseId);
  }
  res.json({ courseIds });
}));

router.put('/:courseId/viewed', requireAuth, requireRole('student'), asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const enrolled = await get(`SELECT id FROM enrollments WHERE courseId = ? AND studentId = ? AND status = 'enrolled'`, [courseId, req.user.sub]);
  if (!enrolled) return res.status(403).json({ error: 'You are not enrolled in this course.' });

  const existing = await get('SELECT id FROM course_activity_reads WHERE studentId = ? AND courseId = ?', [req.user.sub, courseId]);
  if (existing) {
    await run('UPDATE course_activity_reads SET lastViewedAt = CURRENT_TIMESTAMP WHERE id = ?', [existing.id]);
  } else {
    await run('INSERT INTO course_activity_reads (studentId, courseId, lastViewedAt) VALUES (?, ?, CURRENT_TIMESTAMP)', [req.user.sub, courseId]);
  }
  res.json({ ok: true });
}));

module.exports = router;
