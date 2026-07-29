/**
 * Shared vocabulary for the announcement/notification system. Source of truth — the frontend
 * mirrors this exact list in UniScheduler-react/src/noticeConstants.js purely for building
 * dropdowns; every value is re-validated server-side in routes/notices.js regardless of what
 * the client sends.
 */

const NOTICE_TYPES = [
  'general', 'academic', 'examination', 'admissions', 'finance', 'registration',
  'enrollment', 'timetable', 'attendance', 'gradebook', 'event', 'emergency',
  'holiday', 'system', 'maintenance', 'other',
];

const NOTICE_PRIORITIES = ['normal', 'important', 'urgent', 'critical'];

// draft -> scheduled|published (or cancelled); scheduled -> published|cancelled;
// published -> archived (or expired, set by the scheduler sweep, never by hand).
const NOTICE_STATUSES = ['draft', 'scheduled', 'published', 'expired', 'archived', 'cancelled'];

// Audience kinds a target group may declare.
const NOTICE_AUDIENCES = ['students', 'faculty', 'staff', 'roles', 'users'];

// Roles this app treats as "Staff" for targeting purposes — every role that isn't a teaching
// faculty member or a student. Mirrors ROLES in permissions.js minus faculty/student/advisor
// (advisor is a faculty-adjacent teaching-support role, grouped with faculty here since it has
// no department/staff-category data of its own to filter by).
const STAFF_ROLES = [
  'admin', 'registrar', 'admissions_officer', 'dept_head', 'dean',
  'exam_officer', 'records_officer', 'bursar', 'viewer',
];

module.exports = { NOTICE_TYPES, NOTICE_PRIORITIES, NOTICE_STATUSES, NOTICE_AUDIENCES, STAFF_ROLES };
