/**
 * Prerequisite / schedule-clash checks shared by the enroll endpoints (single POST / and
 * POST /bulk). Both are advisory here — callers decide whether an issue is a hard block
 * (self-enrollment) or a warning a Registrar/Admin can override (staff-initiated enrollment).
 */
const { all } = require('./db');
const { overlapsMinutes } = require('./scheduling');

/**
 * Prerequisite course codes `studentId` has not satisfied for `courseId`. There is no dedicated
 * "completed/passed" status on enrollments — this reuses the same proxy the original self-enroll
 * hard-block already relied on: an `enrolled` row with no failing grade counts as satisfied,
 * whether the course is finished or still in progress. Returns [] when the course has no
 * prerequisites or all are satisfied.
 */
async function unmetPrerequisites(studentId, courseId) {
  const prereqs = await all('SELECT prerequisiteCourseId FROM course_prerequisites WHERE courseId = ?', [courseId]);
  if (!prereqs.length) return [];
  const missing = [];
  for (const p of prereqs) {
    const satisfied = await all(
      `SELECT id FROM enrollments WHERE studentId = ? AND courseId = ? AND status = 'enrolled' AND (grade IS NULL OR grade != 'F')`,
      [studentId, p.prerequisiteCourseId]
    );
    if (!satisfied.length) {
      const prereqCourse = await all('SELECT code FROM courses WHERE id = ?', [p.prerequisiteCourseId]);
      missing.push(prereqCourse[0] ? prereqCourse[0].code : String(p.prerequisiteCourseId));
    }
  }
  return missing;
}

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

module.exports = { unmetPrerequisites, hasScheduleClash };
