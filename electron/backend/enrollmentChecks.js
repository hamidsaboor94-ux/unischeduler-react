/**
 * Schedule-clash check shared by eligibility.js (which is now the single source of truth for
 * prerequisite satisfaction — see courseFamilyIds/familyCompletionStatus there).
 */
const { all } = require('./db');
const { overlapsMinutes } = require('./scheduling');

/**
 * True if `courseId`'s timetable slots overlap any slot of a course `studentId` is already
 * enrolled in for the same term — mirrors the self-enroll clash check.
 */
async function hasScheduleClash(studentId, courseId, termId) {
  const targetSlots = await all('SELECT * FROM timetable_slots WHERE courseId = ?', [courseId]);
  if (!targetSlots.length) return false;
  const existingSlots = await all(
    `SELECT ts.* FROM timetable_slots ts
     JOIN enrollments e ON e.courseId = ts.courseId
     WHERE e.studentId = ? AND e.status = 'enrolled' AND ts.termId IS ? AND e.courseId != ?`,
    [studentId, termId ?? null, courseId]
  );
  return targetSlots.some(ts => existingSlots.some(es =>
    es.day === ts.day && overlapsMinutes(es.time, es.durationMinutes || 60, ts.time, ts.durationMinutes || 60)));
}

module.exports = { hasScheduleClash };
