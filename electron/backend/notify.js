/** Shared notification-fan-out helper for course-wide notices (assignments, announcements) —
 * see routes/slotExceptions.js for the older single-recipient precedent this generalizes. */
const { all } = require('./db');
const { createNotification } = require('./notificationTypes');

async function notifyCourseStudents(courseId, message, { type, entityType, entityId } = {}) {
  const students = await all(`SELECT studentId FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [courseId]);
  for (const s of students) {
    await createNotification(s.studentId, message, type, { courseId, entityType, entityId });
  }
}

module.exports = { notifyCourseStudents };
