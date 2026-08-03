/** Shared notification-fan-out helper for course-wide notices (assignments, announcements) —
 * see routes/slotExceptions.js for the older single-recipient precedent this generalizes. */
const { all } = require('./db');
const { createBulkNotifications } = require('./notificationTypes');

async function notifyCourseStudents(courseId, message, options = {}) {
  const students = await all(`SELECT studentId FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [courseId]);
  return createBulkNotifications({ recipientUserIds:students.map(s=>s.studentId),message,courseId,
    ...options,deduplicationKeyPrefix:options.deduplicationKeyPrefix||null });
}

module.exports = { notifyCourseStudents };
