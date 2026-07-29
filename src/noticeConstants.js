/**
 * Frontend mirror of the backend's shared announcement vocabulary
 * (uni scheduling/api/src/noticeConstants.js). Used only to build dropdowns/labels — the backend
 * re-validates every value regardless of what the client sends.
 */

export const NOTICE_TYPES = [
  'general', 'academic', 'examination', 'admissions', 'finance', 'registration',
  'enrollment', 'timetable', 'attendance', 'gradebook', 'event', 'emergency',
  'holiday', 'system', 'maintenance', 'other',
];

export const NOTICE_PRIORITIES = ['normal', 'important', 'urgent', 'critical'];

export const NOTICE_STATUSES = ['draft', 'scheduled', 'published', 'expired', 'archived', 'cancelled'];

export const NOTICE_AUDIENCES = ['students', 'faculty', 'staff', 'roles', 'users'];

export const STAFF_ROLES = [
  'admin', 'registrar', 'admissions_officer', 'dept_head', 'dean',
  'exam_officer', 'records_officer', 'bursar', 'viewer',
];

export const PRIORITY_PILL = {
  normal: 'pill-gray', important: 'pill-blue', urgent: 'pill-amber', critical: 'pill-red',
};

export const STATUS_PILL = {
  draft: 'pill-gray', scheduled: 'pill-blue', published: 'pill-green',
  expired: 'pill-amber', archived: 'pill-gray', cancelled: 'pill-red',
};
