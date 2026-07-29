/**
 * Department scoping. Some roles may only see and affect data belonging to a
 * limited set of departments:
 *   - Department Head → the single department on their user record (users.departmentId)
 *   - Dean            → every department in their college (users.collegeId)
 * Both collapse to the same thing at request time: a set of allowed department
 * ids. That set is resolved once at login (departmentScopeForUser) and carried
 * in the JWT as `departmentIds`, so every check here stays synchronous. Every
 * other role is unrestricted (their access is decided by the permission policy).
 *
 * Enforced on the backend, never merely hidden in the UI. Almost all academic
 * data reaches its department through courses.departmentId, so `courseInScope`
 * is the workhorse; teachers, student profiles and applications carry their own
 * department column.
 */
const { get, all } = require('./db');
const { isDepartmentScoped, isCollegeScoped, isDepartmentRestricted } = require('./permissions');

/**
 * Resolves the department ids a user is restricted to, for stamping into their
 * JWT at login. Returns null for unrestricted roles, or an array (possibly
 * empty — which fails closed) for department-restricted ones.
 */
async function departmentScopeForUser(user) {
  if (isDepartmentScoped(user.role)) {
    return user.departmentId != null ? [Number(user.departmentId)] : [];
  }
  if (isCollegeScoped(user.role)) {
    if (user.collegeId == null) return [];
    const rows = await all('SELECT id FROM departments WHERE collegeId = ?', [user.collegeId]);
    return rows.map(r => Number(r.id));
  }
  return null;
}

/** The set of department ids this request is confined to, or null if
 *  unrestricted. Read straight from the JWT (see departmentScopeForUser). A
 *  restricted role with an empty set matches nothing (fails closed). */
function scopedDepartmentIds(req) {
  if (!isDepartmentRestricted(req.user.role)) return null;
  const ids = Array.isArray(req.user.departmentIds) ? req.user.departmentIds : [];
  return ids.map(Number);
}

/** True if this request's role is confined to a limited department set. */
function isScopedRequest(req) {
  return scopedDepartmentIds(req) !== null;
}

/** True if the user may act on data tied to `departmentId`. */
function departmentInScope(req, departmentId) {
  const ids = scopedDepartmentIds(req);
  if (ids === null) return true;
  return departmentId != null && ids.includes(Number(departmentId));
}

/** SQL `IN (...)` fragment + params restricting `column` to the request's
 *  department set, or null when unrestricted. Empty set → matches nothing. */
function departmentScopeClause(req, column = 'departmentId') {
  const ids = scopedDepartmentIds(req);
  if (ids === null) return null;
  if (!ids.length) return { clause: `${column} IN (-1)`, params: [] };
  return { clause: `${column} IN (${ids.map(() => '?').join(', ')})`, params: ids };
}

/**
 * Resolves the department a scoped user's create/write should target.
 *  - unrestricted role → the requested value, unchanged;
 *  - restricted with exactly one allowed dept → that one (requested optional);
 *  - restricted with several → the requested value, which must be in the set.
 * Returns { departmentId } on success or { error } when the choice is invalid.
 */
function resolveScopedDepartment(req, requested) {
  const ids = scopedDepartmentIds(req);
  if (ids === null) return { departmentId: requested };
  const reqId = requested != null ? Number(requested) : null;
  if (reqId != null) {
    return ids.includes(reqId)
      ? { departmentId: reqId }
      : { error: 'You can only act within your own department(s).' };
  }
  if (ids.length === 1) return { departmentId: ids[0] };
  return { error: 'A department in your scope must be specified.' };
}

/** True if the user may touch the given course (by its department). */
async function courseInScope(req, courseId) {
  if (!isScopedRequest(req)) return true;
  if (courseId == null) return false;
  const row = await get('SELECT departmentId FROM courses WHERE id = ?', [courseId]);
  return !!row && departmentInScope(req, row.departmentId);
}

/** True if the user may touch the given teacher (by teachers.departmentId). */
async function teacherInScope(req, teacherId) {
  if (!isScopedRequest(req)) return true;
  if (teacherId == null) return false;
  const row = await get('SELECT departmentId FROM teachers WHERE id = ?', [teacherId]);
  return !!row && departmentInScope(req, row.departmentId);
}

module.exports = {
  departmentScopeForUser, scopedDepartmentIds, isScopedRequest,
  departmentInScope, departmentScopeClause, resolveScopedDepartment,
  courseInScope, teacherInScope,
};
