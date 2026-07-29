const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { canManageCourse } = require('../ownership');
const { notifyCourseStudents } = require('../notify');

const router = express.Router();

async function requireCourseAccess(req, courseId) {
  const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (!course) return { course: null, error: { status: 404, message: 'Course not found' } };
  if (!(await canManageCourse(req, course))) {
    return { course: null, error: { status: 403, message: 'You do not have access to this course.' } };
  }
  return { course, error: null };
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId is required' });

  if (req.user.role === 'student') {
    const enrolled = await get(`SELECT id FROM enrollments WHERE courseId = ? AND studentId = ? AND status = 'enrolled'`, [courseId, req.user.sub]);
    if (!enrolled) return res.status(403).json({ error: 'You are not enrolled in this course.' });
  } else {
    const { error } = await requireCourseAccess(req, courseId);
    if (error) return res.status(error.status).json({ error: error.message });
  }

  res.json(await all('SELECT * FROM announcements WHERE courseId = ? ORDER BY createdAt DESC', [courseId]));
}));

router.post('/', requireAuth, requireRole('admin', 'faculty'), asyncHandler(async (req, res) => {
  const { courseId, message } = req.body;
  if (!courseId || !String(message || '').trim()) return res.status(400).json({ error: 'courseId and message are required' });

  const { course, error } = await requireCourseAccess(req, courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  const result = await run('INSERT INTO announcements (courseId, message, createdBy) VALUES (?, ?, ?)', [course.id, message.trim(), req.user.sub]);
  await logAudit(req.user, 'post-announcement', 'announcements', result.id, { courseId: course.id });

  const notice = `New announcement in ${course.code} — ${course.name}: "${message.trim()}"`;
  await notifyCourseStudents(course.id, notice, { type: 'announcement_posted', entityType: 'announcement', entityId: result.id });

  res.status(201).json(await get('SELECT * FROM announcements WHERE id = ?', [result.id]));
}));

module.exports = router;
