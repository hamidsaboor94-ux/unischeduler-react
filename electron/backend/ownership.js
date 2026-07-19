/**
 * Faculty role-scoping helpers. A faculty user "owns" a course when their
 * linked teachers row (teachers.userId) matches the course's teacherId.
 * Admins bypass every check here; students never own courses.
 */
const { get, all } = require('./db');

/** Returns the teachers.id linked to this user, or null if they aren't linked to a teacher record. */
async function teacherIdForUser(userId) {
  const row = await get('SELECT id FROM teachers WHERE userId = ?', [userId]);
  return row ? row.id : null;
}

/** True if `req.user` may manage `course` (a full course row, or one with at least a teacherId field). Admin always; faculty only if it's theirs. */
async function canManageCourse(req, course) {
  if (!course) return false;
  if (req.user.role === 'admin') return true;
  if (req.user.role !== 'faculty') return false;
  const teacherId = await teacherIdForUser(req.user.sub);
  return teacherId != null && course.teacherId === teacherId;
}

/** True if `req.user` may manage `exam` — same rule as the course it belongs to. */
async function canManageExam(req, exam) {
  if (!exam) return false;
  if (req.user.role === 'admin') return true;
  const course = await get('SELECT teacherId FROM courses WHERE id = ?', [exam.courseId]);
  return canManageCourse(req, course);
}

/** True if `req.user` (faculty) is invigilating `exam`, for read-only "exam duties" visibility beyond their own courses. */
async function isInvigilator(req, exam) {
  if (!exam || req.user.role !== 'faculty') return false;
  const teacherId = await teacherIdForUser(req.user.sub);
  return teacherId != null && exam.invigilatorId === teacherId;
}

/** SQL WHERE fragment + params restricting a courses query to a faculty user's own courses. Returns null for admin (no restriction needed). */
async function courseScopeClause(req) {
  if (req.user.role !== 'faculty') return null;
  const teacherId = await teacherIdForUser(req.user.sub);
  return { clause: 'teacherId = ?', params: [teacherId ?? -1] };
}

/** Course ids a student is currently enrolled in (any status) — used to scope their view of slots/exams. */
async function enrolledCourseIds(userId) {
  const rows = await all(`SELECT DISTINCT courseId FROM enrollments WHERE studentId = ?`, [userId]);
  return rows.map(r => r.courseId);
}

module.exports = { teacherIdForUser, canManageCourse, canManageExam, isInvigilator, courseScopeClause, enrolledCourseIds };
