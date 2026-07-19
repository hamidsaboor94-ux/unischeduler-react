/** Shared notification-fan-out helper for course-wide notices (assignments, announcements) —
 * see routes/slotExceptions.js for the older single-recipient precedent this generalizes. */
const { all, run } = require('./db');

async function notifyCourseStudents(courseId, message, { type, entityType, entityId } = {}) {
  const students = await all(`SELECT studentId FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [courseId]);
  for (const s of students) {
    await run(
      'INSERT INTO notifications (userId, message, type, courseId, entityType, entityId) VALUES (?, ?, ?, ?, ?, ?)',
      [s.studentId, message, type ?? null, courseId, entityType ?? null, entityId ?? null]
    );
  }
}

module.exports = { notifyCourseStudents };
