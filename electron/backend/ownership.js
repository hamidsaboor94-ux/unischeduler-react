/**
 * Faculty role-scoping helpers. A faculty user "owns" a course when their
 * linked teachers row (teachers.userId) matches the course's teacherId.
 * Admins bypass every check here; students never own courses.
 */
const { get, all } = require('./db');
const { can } = require('./permissions');
const { departmentInScope, departmentScopeClause } = require('./scope');

/** Returns the teachers.id linked to this user, or null if they aren't linked to a teacher record. */
async function teacherIdForUser(userId) {
  const row = await get('SELECT id FROM teachers WHERE userId = ?', [userId]);
  return row ? row.id : null;
}

/**
 * True if `req.user` may manage `course`. Admin always. Staff roles with course
 * write access (Registrar university-wide, Department Head within their own
 * department) qualify by policy + department scope. Faculty qualify only for
 * their own assigned course. `course` must carry `departmentId` (and `teacherId`
 * for the faculty path).
 */
async function canManageCourse(req, course) {
  if (!course) return false;
  const role = req.user.role;
  if (role === 'admin') return true;
  if (role !== 'faculty' && role !== 'student' && can(role, 'courses', 'write')) {
    return departmentInScope(req, course.departmentId);
  }
  if (role !== 'faculty') return false;
  const teacherId = await teacherIdForUser(req.user.sub);
  return teacherId != null && course.teacherId === teacherId;
}

/**
 * True if `req.user` may manage `exam`. Admin always. Staff roles with exam
 * write access (Registrar/Exam Officer university-wide, Department Head within
 * their department) qualify by the exams policy + department scope. Faculty
 * qualify for their own course's exams (via canManageCourse).
 */
async function canManageExam(req, exam) {
  if (!exam) return false;
  const role = req.user.role;
  if (role === 'admin') return true;
  const course = await get('SELECT teacherId, departmentId FROM courses WHERE id = ?', [exam.courseId]);
  if (!course) return false;
  if (role !== 'faculty' && role !== 'student' && can(role, 'exams', 'write')) {
    return departmentInScope(req, course.departmentId);
  }
  return canManageCourse(req, course);
}

/** True if `req.user` (faculty) is invigilating `exam`, for read-only "exam duties" visibility beyond their own courses. */
async function isInvigilator(req, exam) {
  if (!exam || req.user.role !== 'faculty') return false;
  const teacherId = await teacherIdForUser(req.user.sub);
  return teacherId != null && exam.invigilatorId === teacherId;
}

/**
 * True if `req.user` may create/remove enrollments in `course`. Enrollment
 * write (enroll or withdraw) is Super Admin or Registrar only — Faculty manage
 * their course's grades/attendance/materials but do not touch who's on the
 * roster, so unlike canManageCourse this grants no ownership-based access.
 */
async function canModifyEnrollment(req, course) {
  if (!course) return false;
  const role = req.user.role;
  return role === 'admin' || role === 'registrar';
}

/** SQL WHERE fragment + params restricting a courses query by the caller's scope:
 *  a department-restricted role (Department Head → one department, Dean → their
 *  college's departments) to those departments, a faculty user to their own
 *  courses. Returns null when unrestricted (admin, registrar, students browsing
 *  the catalog, etc.). */
async function courseScopeClause(req) {
  const deptClause = departmentScopeClause(req, 'departmentId');
  if (deptClause) return deptClause;
  if (req.user.role !== 'faculty') return null;
  const teacherId = await teacherIdForUser(req.user.sub);
  return { clause: 'teacherId = ?', params: [teacherId ?? -1] };
}

/** Course ids a student is currently enrolled in (any status except a dropped/soft-deleted
    enrollment) — used to scope their view of slots/exams. */
async function enrolledCourseIds(userId) {
  const rows = await all(`SELECT DISTINCT courseId FROM enrollments WHERE studentId = ? AND status != 'dropped'`, [userId]);
  return rows.map(r => r.courseId);
}

module.exports = { teacherIdForUser, canManageCourse, canManageExam, canModifyEnrollment, isInvigilator, courseScopeClause, enrolledCourseIds };
