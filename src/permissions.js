/**
 * Frontend mirror of the backend permission policy
 * (uni scheduling/api/src/permissions.js). Keep the two structurally identical —
 * the backend is the real enforcer (every guard is applied server-side); this
 * copy only decides what the UI shows (sidebar items, action buttons), so a UI
 * that drifts out of sync is a cosmetic bug, never a security hole.
 */

export const MODULES = [
  'dashboard', 'reports', 'timetable', 'rooms', 'courses', 'teachers', 'students',
  'departments', 'terms', 'exams', 'enrollment', 'attendance', 'grades',
  'gradingScale', 'admissions', 'conflicts', 'finance', 'users', 'audit',
  'backup', 'branding', 'announcements', 'approvals',
];

const NONE = 0, READ = 1, WRITE = 2;
const R = READ, W = WRITE;

// key → { name (default English display label, white-labelable), departmentScoped }
export const ROLES = {
  admin:              { name: 'Super Admin',        departmentScoped: false },
  registrar:          { name: 'Registrar',          departmentScoped: false },
  admissions_officer: { name: 'Admissions Officer', departmentScoped: false },
  dept_head:          { name: 'Department Head',    departmentScoped: true  },
  dean:               { name: 'Dean',               collegeScoped: true     },
  exam_officer:       { name: 'Exam Officer',       departmentScoped: false },
  records_officer:    { name: 'Records Officer',    departmentScoped: false },
  bursar:             { name: 'Bursar',             departmentScoped: false },
  viewer:             { name: 'Viewer',             departmentScoped: false },
  advisor:            { name: 'Student Advisor',    departmentScoped: false },
  faculty:            { name: 'Faculty',            departmentScoped: false },
  student:            { name: 'Student',            departmentScoped: false },
};

export const ASSIGNABLE_ROLES = [
  'admin', 'registrar', 'admissions_officer', 'dean', 'dept_head',
  'exam_officer', 'records_officer', 'bursar', 'viewer', 'advisor', 'faculty', 'student',
];

const POLICY = {
  dashboard:    { registrar:R, admissions_officer:R, dean:R, dept_head:R, exam_officer:R, records_officer:R, bursar:R, viewer:R, advisor:R, faculty:R, student:R },
  reports:      { registrar:R, records_officer:W, viewer:R },
  timetable:    { registrar:W, dean:W, dept_head:W, exam_officer:R, viewer:R, faculty:R, student:R },
  rooms:        { registrar:W, dean:R, dept_head:R, exam_officer:R, viewer:R },
  courses:      { registrar:W, dean:W, dept_head:W, exam_officer:R, records_officer:R, viewer:R, faculty:R, student:R },
  teachers:     { registrar:R, dean:W, dept_head:W, viewer:R },
  students:     { registrar:W, records_officer:W, admissions_officer:R, dean:R, dept_head:R, bursar:R, viewer:R },
  departments:  { registrar:R, dean:R, dept_head:R, admissions_officer:R, exam_officer:R, records_officer:R, viewer:R },
  terms:        { registrar:W, dean:R, dept_head:R, exam_officer:R, records_officer:R, admissions_officer:R, bursar:R, viewer:R, faculty:R, student:R },
  exams:        { registrar:W, exam_officer:W, dean:W, dept_head:W, viewer:R, faculty:R, student:R },
  enrollment:   { registrar:W, faculty:R, student:R },
  attendance:   { faculty:W, viewer:R, student:R },
  grades:       { records_officer:W, faculty:W, viewer:R, student:R },
  gradingScale: { records_officer:W, viewer:R },
  admissions:   { registrar:R, admissions_officer:W, dean:R, dept_head:R, viewer:R },
  conflicts:    { registrar:R, exam_officer:R, viewer:R },
  // Finance is Bursar + Super Admin only (RBAC hardening, 2026-07-28) — mirrors api/src/permissions.js.
  finance:      { bursar:W },
  users:        {},
  // Audit Logs are Super Admin only (RBAC hardening, 2026-07-28) — mirrors api/src/permissions.js.
  audit:        {},
  backup:       {},
  branding:     {},
  announcements: { registrar:W, dean:W, dept_head:W, viewer:R },
  // Mirrors api/src/permissions.js — just "may this role see the Approvals page shell at all".
  approvals: { registrar:R, faculty:R },
};

function levelFor(role, module) {
  if (role === 'admin') return WRITE;
  const row = POLICY[module];
  return (row && row[role]) || NONE;
}

/** True if `role` can perform `action` ('read' | 'write') on `module`. */
export function can(role, module, action) {
  return levelFor(role, module) >= (action === 'write' ? WRITE : READ);
}

/** True if this role is confined to its own single department (Department Head). */
export function isDepartmentScoped(role) {
  return !!(ROLES[role] && ROLES[role].departmentScoped);
}

/** True if this role is confined to its own college (Dean). */
export function isCollegeScoped(role) {
  return !!(ROLES[role] && ROLES[role].collegeScoped);
}

/** Module names this role has at least read access to. */
export function accessibleModules(role) {
  return MODULES.filter(m => levelFor(role, m) >= READ);
}

// Section name (the `?section=` value / Section.jsx `name` prop) → module, for the sections
// reachable from Sidebar.jsx's nav (kept in sync with STAFF_NAV there, same convention as the
// frontend/backend POLICY mirror above). Sections NOT listed here — parameterized drill-down
// pages like student-detail/student-profile/teacher-profile/faculty-onboarding/transcript
// (staff mode), reached only via an explicit button + id payload, never a bare nav click — are
// intentionally left ungated by this table; they already enforce access themselves server-side
// and via their own reactive isForbidden handling.
const SECTION_MODULES = {
  dashboard: 'dashboard', reports: 'reports', timetable: 'timetable', rooms: 'rooms',
  courses: 'courses', teachers: 'teachers', students: 'students', departments: 'departments',
  semesters: 'terms', exams: 'exams', enrollment: 'enrollment', attendance: 'attendance',
  gradebook: 'grades', applications: 'admissions', finance: 'finance', conflicts: 'conflicts',
  users: 'users', audit: 'audit', backup: 'backup', branding: 'branding', 'grading-scale': 'gradingScale',
  approvals: 'approvals',
};
// Every role — including ones with no 'announcements' module access — is always at least a
// recipient of announcements addressed to them (matches Sidebar.jsx's STAFF_NAV comment).
const ALWAYS_VISIBLE_SECTIONS = new Set(['announcements']);
// Hand-built role-specific nav items (Sidebar.jsx's advisor/faculty/student navs) whose section
// name doesn't correspond to a POLICY module. Faculty's identically-named nav items (timetable,
// courses, exams, enrollment, attendance, gradebook) don't need an entry here — POLICY already
// grants faculty read on those modules directly.
const ROLE_ONLY_SECTIONS = {
  advisees: ['advisor'],
  catalog: ['student'], myschedule: ['student'], 'my-attendance': ['student'],
  mygrades: ['student'], 'my-fees': ['student'], 'my-transcript': ['student'], 'my-appeals': ['student'],
};

/** True if `role` may navigate to the top-level, sidebar-reachable section `name`. Sections not
    covered by this table (parameterized drill-downs) always return true — unchanged behavior. */
export function canAccessSection(role, name) {
  if (ALWAYS_VISIBLE_SECTIONS.has(name)) return true;
  if (name in SECTION_MODULES) return can(role, SECTION_MODULES[name], 'read');
  if (name in ROLE_ONLY_SECTIONS) return ROLE_ONLY_SECTIONS[name].includes(role);
  return true;
}
