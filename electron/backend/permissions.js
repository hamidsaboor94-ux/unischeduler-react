/**
 * Central role → permission policy. THE single source of truth for what each
 * role can access. The frontend mirrors this exact matrix in
 * UniScheduler-react/src/permissions.js — if you change a rule here, change it
 * there too (the two files are intentionally kept structurally identical).
 *
 * Design (chosen deliberately over a fully-dynamic permission matrix): a fixed
 * set of built-in roles with fixed, audited capabilities. Institutions can
 * RENAME roles (white-label) via branding settings, but cannot redefine which
 * modules a role touches — that keeps enforcement correct and un-bypassable.
 */

// Every access-controlled area of the app. Backend route guards and the
// frontend sidebar both key off these module names.
const MODULES = [
  'dashboard', 'reports', 'timetable', 'rooms', 'courses', 'teachers', 'students',
  'departments', 'terms', 'exams', 'enrollment', 'attendance', 'grades',
  'gradingScale', 'admissions', 'conflicts', 'finance', 'users', 'audit',
  'backup', 'branding', 'announcements', 'approvals',
];

// Access levels. WRITE implies READ. Absence of a role from a module's row
// means NO access to that module at all.
const NONE = 0, READ = 1, WRITE = 2;
const R = READ, W = WRITE;

// Built-in roles. `key` (the object key) is what's stored in users.role and the
// JWT. `name` is the default English display label, overridable per-institution.
// `departmentScoped: true` → this role only ever sees/affects data in the single
// department on their user record (users.departmentId), enforced on the backend.
// `ownershipScoped` / `self` roles (faculty/student) keep their existing
// per-object enforcement (ownership.js) and are NOT governed by module writes.
const ROLES = {
  admin:              { name: 'Super Admin',        departmentScoped: false },
  registrar:          { name: 'Registrar',          departmentScoped: false },
  admissions_officer: { name: 'Admissions Officer', departmentScoped: false },
  dept_head:          { name: 'Department Head',    departmentScoped: true  },
  dean:               { name: 'Dean',               collegeScoped: true     },
  exam_officer:       { name: 'Exam Officer',       departmentScoped: false },
  records_officer:    { name: 'Records Officer',    departmentScoped: false },
  bursar:             { name: 'Bursar',             departmentScoped: false },
  viewer:             { name: 'Viewer',             departmentScoped: false },
  advisor:            { name: 'Student Advisor',    departmentScoped: false, ownershipScoped: true },
  faculty:            { name: 'Faculty',            departmentScoped: false, ownershipScoped: true },
  student:            { name: 'Student',            departmentScoped: false, self: true },
};

// Roles a Super Admin may assign from the Users page. Faculty/student keep their
// existing creation flows (which provision teacher rows / profiles); the staff
// roles are assignable to any account. admin stays assignable too.
const ASSIGNABLE_ROLES = [
  'admin', 'registrar', 'admissions_officer', 'dean', 'dept_head',
  'exam_officer', 'records_officer', 'bursar', 'viewer', 'advisor', 'faculty', 'student',
];

// module → { role: level }. admin is implicitly WRITE everywhere and omitted.
// A role missing from a row has no access to that module.
const POLICY = {
  dashboard:    { registrar:R, admissions_officer:R, dean:R, dept_head:R, exam_officer:R, records_officer:R, bursar:R, viewer:R, advisor:R, faculty:R, student:R },
  // reports/conflicts/attendance are university-wide aggregate views not yet
  // department-filtered, so the department-restricted roles (dean/dept_head) are
  // intentionally excluded to avoid leaking other departments' data.
  // viewer/records_officer/registrar are university-wide roles by design.
  reports:      { registrar:R, records_officer:W, viewer:R },
  timetable:    { registrar:W, dean:W, dept_head:W, exam_officer:R, viewer:R, faculty:R, student:R },
  rooms:        { registrar:W, dean:R, dept_head:R, exam_officer:R, viewer:R },
  courses:      { registrar:W, dean:W, dept_head:W, exam_officer:R, records_officer:R, viewer:R, faculty:R, student:R },
  teachers:     { registrar:R, dean:W, dept_head:W, viewer:R },
  // The canonical per-student academic view (Students page) — a read surface over data owned by
  // admissions/enrollment/finance, not a separate write path, so every role here gets read-only
  // ('View') access regardless of level; nothing writes through this module.
  students:     { registrar:W, records_officer:W, admissions_officer:R, dean:R, dept_head:R, bursar:R, viewer:R },
  departments:  { registrar:R, dean:R, dept_head:R, admissions_officer:R, exam_officer:R, records_officer:R, viewer:R },
  terms:        { registrar:W, dean:R, dept_head:R, exam_officer:R, records_officer:R, admissions_officer:R, bursar:R, viewer:R, faculty:R, student:R },
  exams:        { registrar:W, exam_officer:W, dean:W, dept_head:W, viewer:R, faculty:R, student:R },
  // enrollment/grades are course-keyed aggregate surfaces not yet department-
  // filtered per-course, so dean/dept_head are excluded for now (they manage
  // their scope through courses/teachers/timetable/exams, all fully scoped).
  enrollment:   { registrar:W, faculty:R, student:R },
  attendance:   { faculty:W, viewer:R, student:R },
  grades:       { records_officer:W, faculty:W, viewer:R, student:R },
  gradingScale: { records_officer:W, viewer:R },
  // registrar is the university-wide operations role (see announcements below) and needs read
  // visibility into admissions to answer "has this student been admitted" questions — write stays
  // with admissions_officer, who owns the decision workflow.
  admissions:   { registrar:R, admissions_officer:W, dean:R, dept_head:R, viewer:R },
  conflicts:    { registrar:R, exam_officer:R, viewer:R },
  // Fees, payments and balances. Students read their own statement via
  // /finance/me (self-scoped, not module-gated); this governs staff access.
  // Finance is Bursar + Super Admin only — Viewer's "explicitly authorized read-only data" does
  // not extend to every student's financial statements by default (RBAC hardening, 2026-07-28).
  finance:      { bursar:W },
  users:        { /* Super Admin only */ },
  // Audit Logs are Super Admin only per the RBAC role table — Viewer previously had unscoped,
  // unredacted read on the entire audit trail (RBAC hardening, 2026-07-28).
  audit:        { },
  backup:       { /* Super Admin only */ },
  branding:     { /* Super Admin only */ },
  // Manage/compose university-wide announcements. registrar is the university-wide operations
  // role (targets any audience); dean/dept_head get write too but are confined to their own
  // college/department when targeting (enforced server-side in noticeTargeting.js, on top of
  // this module check — same layering as courses/timetable above). Every authenticated user,
  // regardless of this policy, can always read notices addressed to them via the self-scoped
  // /notices/me endpoints (not module-gated, matching /finance/me).
  announcements: { registrar:W, dean:W, dept_head:W, viewer:R },
  // The Approvals reviewer queue (see approvalEngine.js) — just "may this role see the page
  // shell at all". Real per-request eligibility (whose turn it is, canAct ownership checks) is
  // enforced dynamically server-side in approvalEngine.js, not by this module policy.
  approvals: { registrar:R, faculty:R },
};

/** Access level (0/1/2) a role has for a module. admin always WRITE. */
function levelFor(role, module) {
  if (role === 'admin') return WRITE;
  const row = POLICY[module];
  return (row && row[role]) || NONE;
}

/** True if `role` can perform `action` ('read' | 'write') on `module`. */
function can(role, module, action) {
  return levelFor(role, module) >= (action === 'write' ? WRITE : READ);
}

/** True if this role is confined to its own single department (users.departmentId). */
function isDepartmentScoped(role) {
  return !!(ROLES[role] && ROLES[role].departmentScoped);
}

/** True if this role is confined to its own college (users.collegeId), which
 *  resolves to the set of departments in that college (Dean). */
function isCollegeScoped(role) {
  return !!(ROLES[role] && ROLES[role].collegeScoped);
}

/** True if this role is restricted to a limited set of departments — either a
 *  single one (Department Head) or a college's worth (Dean). Such a role's
 *  allowed department ids are resolved at login and carried in the JWT. */
function isDepartmentRestricted(role) {
  return isDepartmentScoped(role) || isCollegeScoped(role);
}

/** Module names this role has at least read access to (drives the sidebar). */
function accessibleModules(role) {
  return MODULES.filter(m => levelFor(role, m) >= READ);
}

module.exports = {
  MODULES, ROLES, ASSIGNABLE_ROLES, POLICY, NONE, READ, WRITE,
  levelFor, can, isDepartmentScoped, isCollegeScoped, isDepartmentRestricted, accessibleModules,
};
