const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Which of the student's enrolled courses have an assignment, announcement, or material posted
// since they last opened that course's activity card, and exactly how many. A missing
// course_activity_reads row (never opened) means everything posted so far counts as unviewed.
// `courseIds` (unchanged shape) drives the existing boolean unread dot on the Assignments quick
// action; `counts` is additive, for the per-course unseen-item badge on the class cards.
router.get('/status', requireAuth, requireRole('student'), asyncHandler(async (req, res) => {
  const courses = await all(`SELECT DISTINCT courseId FROM enrollments WHERE studentId = ? AND status = 'enrolled'`, [req.user.sub]);
  const courseIds = [];
  const counts = {};
  for (const { courseId } of courses) {
    const read = await get('SELECT lastViewedAt FROM course_activity_reads WHERE studentId = ? AND courseId = ?', [req.user.sub, courseId]);
    const since = read?.lastViewedAt || '1970-01-01 00:00:00';
    const unseen = await get(
      `SELECT COUNT(*) as c FROM (
         SELECT createdAt FROM assignments WHERE courseId = ?
         UNION ALL SELECT createdAt FROM announcements WHERE courseId = ?
         UNION ALL SELECT createdAt FROM course_materials WHERE courseId = ?
       ) WHERE createdAt > ?`,
      [courseId, courseId, courseId, since]
    );
    if (unseen.c > 0) { courseIds.push(courseId); counts[courseId] = unseen.c; }
  }
  res.json({ courseIds, counts });
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
