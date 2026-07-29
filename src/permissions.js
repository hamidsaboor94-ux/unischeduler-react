/**
 * Frontend mirror of the backend permission policy
 * (uni scheduling/api/src/permissions.js). Keep the two structurally identical —
 * the backend is the real enforcer (every guard is applied server-side); this
 * copy only decides what the UI shows (sidebar items, action buttons), so a UI
 * that drifts out of sync is a cosmetic bug, never a security hole.
 */

export const MODULES = [
  'dashboard', 'reports', 'timetable', 'rooms', 'courses', 'teachers',
  'departments', 'terms', 'exams', 'enrollment', 'attendance', 'grades',
  'gradingScale', 'admissions', 'conflicts', 'finance', 'users', 'audit',
  'backup', 'branding',
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
  departments:  { registrar:R, dean:R, dept_head:R, admissions_officer:R, exam_officer:R, records_officer:R, viewer:R },
  terms:        { registrar:W, dean:R, dept_head:R, exam_officer:R, records_officer:R, admissions_officer:R, viewer:R, faculty:R, student:R },
  exams:        { registrar:W, exam_officer:W, dean:W, dept_head:W, viewer:R, faculty:R, student:R },
  enrollment:   { registrar:W, faculty:R, student:R },
  attendance:   { faculty:W, viewer:R, student:R },
  grades:       { records_officer:W, faculty:W, viewer:R, student:R },
  gradingScale: { records_officer:W, viewer:R },
  admissions:   { admissions_officer:W, dean:R, dept_head:R, viewer:R },
  conflicts:    { registrar:R, exam_officer:R, viewer:R },
  finance:      { bursar:W, viewer:R },
  users:        {},
  audit:        { viewer:R },
  backup:       {},
  branding:     {},
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
