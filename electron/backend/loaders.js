const { all } = require('./db');

/**
 * Loads all data the scheduling engine needs for a given term (or every
 * term if termId is falsy) in the shape scheduling.js expects.
 */
async function loadTermData(termId) {
  const termClause = termId ? 'WHERE termId = ?' : '';
  const params = termId ? [termId] : [];
  const courses = await all(`SELECT * FROM courses ${termClause}`, params);
  const courseIds = courses.map(c => c.id);
  const placeholders = courseIds.map(() => '?').join(',');

  const slots = courseIds.length
    ? await all(`SELECT * FROM timetable_slots WHERE courseId IN (${placeholders})`, courseIds)
    : [];
  const slotIds = slots.map(s => s.id);
  const exceptions = slotIds.length
    ? await all(`SELECT * FROM slot_exceptions WHERE slotId IN (${slotIds.map(() => '?').join(',')})`, slotIds)
    : [];
  const exams = courseIds.length
    ? await all(`SELECT * FROM exams WHERE courseId IN (${placeholders})`, courseIds)
    : [];
  const rooms = await all('SELECT * FROM rooms');
  const teachers = await all('SELECT * FROM teachers');
  const enrollmentRows = courseIds.length
    ? await all(`SELECT * FROM enrollments WHERE status = 'enrolled' AND courseId IN (${placeholders})`, courseIds)
    : [];

  const enrollmentsByCourse = new Map();
  enrollmentRows.forEach(r => {
    if (!enrollmentsByCourse.has(r.courseId)) enrollmentsByCourse.set(r.courseId, []);
    enrollmentsByCourse.get(r.courseId).push(r.studentId);
  });

  return { courses, slots, exams, rooms, teachers, enrollmentsByCourse, exceptions };
}

module.exports = { loadTermData };
