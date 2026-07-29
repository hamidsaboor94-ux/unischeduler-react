/**
 * The announcement targeting engine: turns a notice's structured target groups into a concrete,
 * deduplicated set of recipient user ids, entirely server-side. Nothing here ever trusts a
 * client-supplied recipient list — every audience/filter combination is re-resolved against real
 * users/student_profiles/teachers/courses rows.
 *
 * A "target group" is { audience: 'students'|'faculty'|'staff'|'roles'|'users', filters: {...} }.
 * Different filter keys within one group are ANDed together; multiple values for the same key
 * (e.g. two department ids) are ORed via SQL IN(...). Multiple groups on one notice are unioned
 * (a person matching more than one group still gets exactly one notice — see notice_recipients'
 * UNIQUE(noticeId, userId)).
 */
const { get, all } = require('./db');
const { ROLES } = require('./permissions');
const { isScopedRequest, scopedDepartmentIds } = require('./scope');
const { NOTICE_AUDIENCES, STAFF_ROLES } = require('./noticeConstants');

class TargetingError extends Error {}

function inClause(values) {
  return values.map(() => '?').join(', ');
}

/** Cleans a raw array of ids into deduped positive integers, capped so one filter can't be
    used to smuggle an unbounded query. Non-numeric/garbage entries are silently dropped rather
    than rejecting the whole request — the UI never sends anything but real ids anyway. */
function idArray(value, max = 1000) {
  if (!Array.isArray(value)) return [];
  const ids = [...new Set(value.map(Number).filter(n => Number.isInteger(n) && n > 0))];
  return ids.slice(0, max);
}

function stringArray(value, max = 100) {
  if (!Array.isArray(value)) return [];
  const strs = [...new Set(value.map(v => String(v ?? '').trim()).filter(Boolean))];
  return strs.slice(0, max);
}

/** Validates + whitelists a target group's raw filters for its audience, dropping any key not
    on that audience's list (so a client can never sneak in an unsupported/unsafe filter key).
    Throws TargetingError for a structurally invalid group (unknown audience, empty 'roles'/
    'users' with nothing selected). */
function validateGroup(rawGroup) {
  const audience = rawGroup && rawGroup.audience;
  if (!NOTICE_AUDIENCES.includes(audience)) throw new TargetingError(`Unknown audience "${audience}".`);
  const raw = rawGroup.filters || {};
  const filters = {};

  if (audience === 'students') {
    if (idArray(raw.departmentIds).length) filters.departmentIds = idArray(raw.departmentIds);
    if (idArray(raw.collegeIds).length) filters.collegeIds = idArray(raw.collegeIds);
    if (idArray(raw.programIds).length) filters.programIds = idArray(raw.programIds);
    if (idArray(raw.semesters).length) filters.semesters = idArray(raw.semesters);
    if (stringArray(raw.sections).length) filters.sections = stringArray(raw.sections);
    if (stringArray(raw.statuses).length) filters.statuses = stringArray(raw.statuses);
    if (idArray(raw.courseIds).length) filters.courseIds = idArray(raw.courseIds);
  } else if (audience === 'faculty') {
    if (idArray(raw.departmentIds).length) filters.departmentIds = idArray(raw.departmentIds);
    if (idArray(raw.collegeIds).length) filters.collegeIds = idArray(raw.collegeIds);
    if (stringArray(raw.designations).length) filters.designations = stringArray(raw.designations);
    if (stringArray(raw.employmentTypes).length) filters.employmentTypes = stringArray(raw.employmentTypes);
    if (stringArray(raw.statuses).length) filters.statuses = stringArray(raw.statuses);
    if (idArray(raw.courseIds).length) filters.courseIds = idArray(raw.courseIds);
  } else if (audience === 'staff') {
    const roles = stringArray(raw.roles).filter(r => STAFF_ROLES.includes(r));
    if (roles.length) filters.roles = roles;
    if (idArray(raw.departmentIds).length) filters.departmentIds = idArray(raw.departmentIds);
    if (idArray(raw.collegeIds).length) filters.collegeIds = idArray(raw.collegeIds);
  } else if (audience === 'roles') {
    const roles = stringArray(raw.roles).filter(r => Object.keys(ROLES).includes(r));
    if (!roles.length) throw new TargetingError('Select at least one role.');
    filters.roles = roles;
  } else if (audience === 'users') {
    const userIds = idArray(raw.userIds, 5000);
    if (!userIds.length) throw new TargetingError('Select at least one recipient.');
    filters.userIds = userIds;
  }

  return { audience, filters };
}

function validateGroups(rawGroups) {
  if (!Array.isArray(rawGroups) || !rawGroups.length) {
    throw new TargetingError('At least one recipient group is required.');
  }
  return rawGroups.map(validateGroup);
}

async function resolveStudentIds(filters) {
  const clauses = [`u.role = 'student'`];
  const params = [];
  if (filters.departmentIds) { clauses.push(`sp.departmentId IN (${inClause(filters.departmentIds)})`); params.push(...filters.departmentIds); }
  if (filters.collegeIds) { clauses.push(`d.collegeId IN (${inClause(filters.collegeIds)})`); params.push(...filters.collegeIds); }
  if (filters.programIds) { clauses.push(`sp.programId IN (${inClause(filters.programIds)})`); params.push(...filters.programIds); }
  if (filters.semesters) { clauses.push(`sp.programSemester IN (${inClause(filters.semesters)})`); params.push(...filters.semesters); }
  if (filters.sections) { clauses.push(`sp.section IN (${inClause(filters.sections)})`); params.push(...filters.sections); }
  if (filters.statuses) { clauses.push(`sp.enrollmentStatus IN (${inClause(filters.statuses)})`); params.push(...filters.statuses); }
  if (filters.courseIds) {
    clauses.push(`EXISTS (SELECT 1 FROM enrollments e WHERE e.studentId = u.id AND e.status = 'enrolled' AND e.courseId IN (${inClause(filters.courseIds)}))`);
    params.push(...filters.courseIds);
  }
  const rows = await all(
    `SELECT DISTINCT u.id FROM users u
     LEFT JOIN student_profiles sp ON sp.studentId = u.id
     LEFT JOIN departments d ON d.id = sp.departmentId
     WHERE ${clauses.join(' AND ')}`,
    params
  );
  return rows.map(r => r.id);
}

async function resolveFacultyIds(filters) {
  const clauses = [`u.role = 'faculty'`];
  const params = [];
  if (filters.departmentIds) { clauses.push(`t.departmentId IN (${inClause(filters.departmentIds)})`); params.push(...filters.departmentIds); }
  if (filters.collegeIds) { clauses.push(`d.collegeId IN (${inClause(filters.collegeIds)})`); params.push(...filters.collegeIds); }
  if (filters.designations) { clauses.push(`tp.designation IN (${inClause(filters.designations)})`); params.push(...filters.designations); }
  if (filters.employmentTypes) { clauses.push(`tp.employmentType IN (${inClause(filters.employmentTypes)})`); params.push(...filters.employmentTypes); }
  if (filters.statuses) { clauses.push(`tp.status IN (${inClause(filters.statuses)})`); params.push(...filters.statuses); }
  if (filters.courseIds) {
    clauses.push(`EXISTS (SELECT 1 FROM courses c WHERE c.teacherId = t.id AND c.id IN (${inClause(filters.courseIds)}))`);
    params.push(...filters.courseIds);
  }
  const rows = await all(
    `SELECT DISTINCT u.id FROM users u
     JOIN teachers t ON t.userId = u.id
     LEFT JOIN teacher_profiles tp ON tp.teacherId = t.id
     LEFT JOIN departments d ON d.id = t.departmentId
     WHERE ${clauses.join(' AND ')}`,
    params
  );
  return rows.map(r => r.id);
}

async function resolveStaffIds(filters) {
  const roles = filters.roles && filters.roles.length ? filters.roles : STAFF_ROLES;
  const clauses = [`u.role IN (${inClause(roles)})`];
  const params = [...roles];
  if (filters.departmentIds || filters.collegeIds) {
    const or = [];
    if (filters.departmentIds) { or.push(`u.departmentId IN (${inClause(filters.departmentIds)})`); params.push(...filters.departmentIds); }
    if (filters.collegeIds) { or.push(`u.collegeId IN (${inClause(filters.collegeIds)})`); params.push(...filters.collegeIds); }
    clauses.push(`(${or.join(' OR ')})`);
  }
  const rows = await all(`SELECT DISTINCT u.id FROM users u WHERE ${clauses.join(' AND ')}`, params);
  return rows.map(r => r.id);
}

async function resolveRoleIds(filters) {
  const roles = filters.roles;
  const rows = await all(
    `SELECT id FROM users WHERE role IN (${inClause(roles)})
     UNION
     SELECT userId as id FROM user_roles WHERE role IN (${inClause(roles)})`,
    [...roles, ...roles]
  );
  return rows.map(r => r.id);
}

async function resolveUserIds(filters) {
  const rows = await all(`SELECT id FROM users WHERE id IN (${inClause(filters.userIds)})`, filters.userIds);
  return rows.map(r => r.id);
}

async function resolveGroupIds(group) {
  switch (group.audience) {
    case 'students': return resolveStudentIds(group.filters);
    case 'faculty': return resolveFacultyIds(group.filters);
    case 'staff': return resolveStaffIds(group.filters);
    case 'roles': return resolveRoleIds(group.filters);
    case 'users': return resolveUserIds(group.filters);
    default: return [];
  }
}

/** Resolves every group and returns per-group counts plus the deduplicated union of ids —
    the single source of truth used by both the "preview recipients" endpoint (counts only)
    and the actual publish step (which persists the union as notice_recipients). */
async function resolveRecipients(groups) {
  const perGroup = [];
  const total = new Set();
  for (const group of groups) {
    const ids = await resolveGroupIds(group);
    perGroup.push({ audience: group.audience, count: ids.length });
    ids.forEach(id => total.add(id));
  }
  return { perGroup, recipientIds: [...total] };
}

/** The department a given course belongs to, for scope-checking a 'courseIds' filter. */
async function courseDepartmentIds(courseIds) {
  if (!courseIds.length) return [];
  const rows = await all(`SELECT departmentId FROM courses WHERE id IN (${inClause(courseIds)})`, courseIds);
  return rows.map(r => r.departmentId).filter(id => id != null);
}

/** The effective department of an individual user, for scope-checking a 'users' group — a
    student's via student_profiles, a faculty member's via teachers, anyone else's via
    users.departmentId directly. Returns null if it can't be determined (fails closed by the
    caller, which treats null as out-of-scope). */
async function userDepartmentId(userId) {
  const row = await get(
    `SELECT COALESCE(sp.departmentId, t.departmentId, u.departmentId) as departmentId
     FROM users u
     LEFT JOIN student_profiles sp ON sp.studentId = u.id
     LEFT JOIN teachers t ON t.userId = u.id
     WHERE u.id = ?`,
    [userId]
  );
  return row ? row.departmentId : null;
}

/**
 * Confines what a department/college-scoped caller (Dept Head, Dean — see scope.js) may target.
 * Unrestricted roles (Registrar, Admin) skip this entirely. A scoped caller must:
 *  - never use the 'roles' audience (inherently university-wide),
 *  - always narrow 'students'/'faculty'/'staff' groups to department ids within their own scope
 *    (no college-wide or "all departments" targeting), and any courseIds filter must belong to
 *    an in-scope department too,
 *  - only target 'users' whose own department is in scope.
 * Throws TargetingError on any violation — callers should turn that into a 403.
 */
async function enforceTargetingScope(req, groups) {
  if (!isScopedRequest(req)) return;
  const allowed = new Set(scopedDepartmentIds(req));
  if (!allowed.size) throw new TargetingError('You have no department scope configured for announcements — contact an administrator.');

  for (const group of groups) {
    if (group.audience === 'roles') {
      throw new TargetingError('Role-based targeting is only available to university-wide roles.');
    }
    if (group.audience === 'students' || group.audience === 'faculty' || group.audience === 'staff') {
      const deptIds = group.filters.departmentIds || [];
      if (!deptIds.length) throw new TargetingError('Select a department within your scope — you cannot target every department.');
      if (deptIds.some(id => !allowed.has(Number(id)))) throw new TargetingError('One of the selected departments is outside your scope.');
      if (group.filters.collegeIds && group.filters.collegeIds.length) {
        throw new TargetingError('College-wide targeting is not available at your scope.');
      }
      if (group.filters.courseIds && group.filters.courseIds.length) {
        const courseDepts = await courseDepartmentIds(group.filters.courseIds);
        if (courseDepts.some(id => !allowed.has(Number(id)))) {
          throw new TargetingError('One of the selected courses is outside your department scope.');
        }
      }
    }
    if (group.audience === 'users') {
      for (const userId of group.filters.userIds) {
        const deptId = await userDepartmentId(userId);
        if (deptId == null || !allowed.has(Number(deptId))) {
          throw new TargetingError('One of the selected users is outside your department scope.');
        }
      }
    }
  }
}

module.exports = {
  TargetingError, validateGroup, validateGroups, resolveRecipients, enforceTargetingScope,
};
