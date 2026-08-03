// Inside Electron, preload.cjs exposes wherever that install's API actually is — its own
// embedded server on a random free port, or a shared server elsewhere on the network,
// depending on how that copy was configured (see electron/server-config.cjs). In the browser,
// VITE_API_BASE (set in a .env file, e.g. VITE_API_BASE=http://192.168.1.50:4000/api) points
// the website at a specific server; without it, it falls back to localhost:4000, matching
// `npm run dev` in the api package with no other configuration.
import { getToken } from './tokenStorage.js';

export const API_BASE = globalThis.UNISCHEDULER_API_BASE || import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

// Some 403s already carry a specific, useful message (e.g. "You do not have permission to enroll
// students in this course.") — those pass through unchanged. Others are just the bare "Forbidden"
// from an older, coarser guard (requireRole/requireModuleAccess) that never expected to be shown
// to someone who legitimately shouldn't have been able to attempt the action in the first place
// (the UI should have hidden/disabled it — see e.g. RoomForm.jsx's canWrite). This is the one
// place that turns that bare string into something a toast can actually show someone.
const GENERIC_FORBIDDEN_MESSAGES = new Set(['Forbidden', undefined, null, '']);
function friendlyErrorMessage(status, data, path) {
  const message = data && data.error;
  if (status === 404 && message === 'Not found' && String(path || '').startsWith('/graduation/')) {
    return 'The running backend does not provide the graduation registry yet. Restart it with the current UMS backend.';
  }
  if (status === 403 && GENERIC_FORBIDDEN_MESSAGES.has(message)) {
    return 'You don’t have permission to do this.';
  }
  return message || `Request failed (${status})`;
}

export async function api(method, path, body) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body, e.g. 204 */ }
  if (!res.ok) {
    const err = new Error(friendlyErrorMessage(res.status, data, path));
    err.status = res.status;
    err.code = data && data.code;
    // Graduation confirm's 422 FINANCE_HOLD carries the exact blocking balance — surfaced here,
    // same spot err.code already rides, rather than adding a second per-route error shape.
    err.outstandingBalance = data && data.outstandingBalance;
    throw err;
  }
  return data;
}

/** Multipart file upload variant of api() — used for the PDF timetable import parse endpoint. */
export async function apiUpload(path, fieldName, file) {
  const token = getToken();
  const form = new FormData();
  form.append(fieldName, file);
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw new Error(friendlyErrorMessage(res.status, data));
  return data;
}

/** Authenticated file download — fetches `path` and hands the result to the browser
    as a "save file" of `filename`. Used for the database backup export. */
export async function apiDownload(path, filename) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON error body */ }
    throw new Error(friendlyErrorMessage(res.status, data));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* --------------------------- CRUD wrappers ----------------------------- */
export const saveTeacher = (data, id) => (id ? api('PUT', `/teachers/${id}`, data) : api('POST', '/teachers', data));
export const deleteTeacher = (id) => api('DELETE', `/teachers/${id}`);
export const saveRoom = (data, id) => (id ? api('PUT', `/rooms/${id}`, data) : api('POST', '/rooms', data));
export const deleteRoom = (id) => api('DELETE', `/rooms/${id}`);
export const saveCourse = (data, id) => (id ? api('PUT', `/courses/${id}`, data) : api('POST', '/courses', data));
export const deleteCourse = (id) => api('DELETE', `/courses/${id}`);
export const fetchCoursePrerequisites = (courseId) => api('GET', `/courses/${courseId}/prerequisites`);
export const addCoursePrerequisite = (courseId, prerequisiteCourseId, { groupId, type } = {}) =>
  api('POST', `/courses/${courseId}/prerequisites`, { prerequisiteCourseId, groupId, type });
export const removeCoursePrerequisite = (courseId, prerequisiteCourseId) =>
  api('DELETE', `/courses/${courseId}/prerequisites/${prerequisiteCourseId}`);
export const fetchCourseSlots = (courseId) => api('GET', `/courses/${courseId}/slots`);
export const registerForCourse = (courseId) => api('POST', '/enrollments', { courseId });
export const fetchEligibleCourses = () => api('GET', '/students/me/eligible-courses');
export const saveSlot = (data, id) => (id ? api('PUT', `/slots/${id}`, data) : api('POST', '/slots', data));
export const deleteSlot = (id) => api('DELETE', `/slots/${id}`);
export const saveSlotException = (data) => api('POST', '/slot-exceptions', data);
export const deleteSlotException = (id) => api('DELETE', `/slot-exceptions/${id}`);
export const rescheduleSlotException = (id, data) => api('PUT', `/slot-exceptions/${id}/reschedule`, data);
/** Rooms/times actually free at an exact day-or-date + time, for the Conflict detail card's
    reschedule dropdowns — see api/src/routes/conflicts.js. `params` values of null/undefined
    are dropped so optional filters (date vs. day, excludeSlotId, etc.) don't end up as the
    literal string "undefined" in the query. */
function qs(params) {
  return Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
export const fetchAvailableRooms = (params) => api('GET', `/conflicts/available-rooms?${qs(params)}`);
export const fetchAvailableTimes = (params) => api('GET', `/conflicts/available-times?${qs(params)}`);
export const markNotificationRead = (id) => api('PUT', `/notifications/${id}/read`);
export const markAllNotificationsRead = () => api('PUT', '/notifications/read-all');
export const fetchNotifications = (params={}) => api('GET', `/notifications?${qs(params)}`);
export const fetchNotificationPreferences = () => api('GET','/notifications/preferences');
export const updateNotificationPreference = (category,enabled) => api('PUT',`/notifications/preferences/${category}`,{enabled});
export const fetchCourseAttendance = (courseId) => api('GET', `/attendance?courseId=${courseId}`);
export const fetchCourseRoster = (courseId) => api('GET', `/courses/${courseId}/roster`);
export const fetchMyAttendance = () => api('GET', '/attendance/me');
export const submitAttendance = (data) => api('POST', '/attendance/bulk', data);
export const saveExam = (data, id) => (id ? api('PUT', `/exams/${id}`, data) : api('POST', '/exams', data));
export const deleteExam = (id) => api('DELETE', `/exams/${id}`);
export const withdrawFromCourse = (enrollmentId) => api('DELETE', `/enrollments/${enrollmentId}`);
export const fetchEligibleStudents = (courseId) => api('GET', `/courses/${courseId}/eligible-students`);
export const bulkEnrollStudents = (courseId, studentIds, overrideStudentIds) =>
  api('POST', '/enrollments/bulk', { courseId, studentIds, overrideStudentIds });
export const saveTerm = (data, id) => (id ? api('PUT', `/terms/${id}`, data) : api('POST', '/terms', data));
export const deleteTerm = (id) => api('DELETE', `/terms/${id}`);
export const saveDepartment = (data, id) => (id ? api('PUT', `/departments/${id}`, data) : api('POST', '/departments', data));
export const deleteDepartment = (id) => api('DELETE', `/departments/${id}`);
export const saveCollege = (data, id) => (id ? api('PUT', `/colleges/${id}`, data) : api('POST', '/colleges', data));
export const deleteCollege = (id) => api('DELETE', `/colleges/${id}`);
export const saveProgram = (data, id) => (id ? api('PUT', `/programs/${id}`, data) : api('POST', '/programs', data));
export const deleteProgram = (id) => api('DELETE', `/programs/${id}`);
export const saveStudentType = (data, id) => (id ? api('PUT', `/student-types/${id}`, data) : api('POST', '/student-types', data));
export const deleteStudentType = (id) => api('DELETE', `/student-types/${id}`);
export const deleteUser = (id) => api('DELETE', `/users/${id}`);
export const fetchBranding = () => api('GET', '/settings/branding');
export const saveBranding = (data) => api('PUT', '/settings/branding', data);
export const removeLogo = () => api('DELETE', '/settings/branding/logo');
export const fetchMyProfile = () => api('GET', '/auth/me');
export const updateMyProfile = (data) => api('PUT', '/auth/profile', data);
export const changeMyPassword = (data) => api('PUT', '/auth/change-password', data);
export const updateMyLanguage = (language) => api('PUT', '/auth/language', { language });
export const fetchGradeItems = (courseId) => api('GET', `/grades/items?courseId=${courseId}`);
export const saveGradeItem = (data, id) => (id ? api('PUT', `/grades/items/${id}`, data) : api('POST', '/grades/items', data));
export const deleteGradeItem = (id) => api('DELETE', `/grades/items/${id}`);
export const fetchCourseGradebook = (courseId) => api('GET', `/grades?courseId=${courseId}`);
export const setGradeScore = (data) => api('PUT', '/grades/score', data);
export const fetchDepartmentGradeSummary = (departmentId) => api('GET', `/grades/department-summary${departmentId ? `?departmentId=${departmentId}` : ''}`);
export const fetchMyGrades = () => api('GET', '/grades/me');
export const fetchMyTranscript = () => api('GET', '/transcript/me');
export const fetchStudentTranscript = (studentId) => api('GET', `/transcript/students/${studentId}`);
export const fetchGradingScale = () => api('GET', '/settings/grading-scale');
export const saveGradingScale = (bands) => api('PUT', '/settings/grading-scale', { bands });
export const fetchCourseAssignments = (courseId) => api('GET', `/assignments?courseId=${courseId}`);
export const saveAssignment = (data) => api('POST', '/assignments', data);
export const fetchAssignmentSubmissions = (id) => api('GET', `/assignments/${id}/submissions`);
export const gradeSubmission = (assignmentId, studentId, data) => api('PUT', `/assignments/${assignmentId}/submissions/${studentId}`, data);
export const fetchCourseAnnouncements = (courseId) => api('GET', `/announcements?courseId=${courseId}`);
export const saveAnnouncement = (data) => api('POST', '/announcements', data);

/* ------------------------- University-wide announcement system ------------------------- */
export const fetchNoticeTargetingOptions = () => api('GET', '/notices/meta/targeting-options');
export const searchNoticeUsers = (q) => api('GET', `/notices/meta/users-search?q=${encodeURIComponent(q)}`);
export const previewNoticeRecipients = (targetGroups) => api('POST', '/notices/preview-recipients', { targetGroups });
export const fetchNotices = (filters = {}) => {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  return api('GET', `/notices${qs ? `?${qs}` : ''}`);
};
export const fetchNotice = (id) => api('GET', `/notices/${id}`);
export const createNotice = (data) => api('POST', '/notices', data);
export const updateNotice = (id, data) => api('PUT', `/notices/${id}`, data);
export const duplicateNotice = (id) => api('POST', `/notices/${id}/duplicate`, {});
export const publishNotice = (id) => api('POST', `/notices/${id}/publish`, {});
export const scheduleNotice = (id, scheduledFor) => api('POST', `/notices/${id}/schedule`, { scheduledFor });
export const cancelNoticeSchedule = (id) => api('POST', `/notices/${id}/cancel-schedule`, {});
export const archiveNotice = (id) => api('POST', `/notices/${id}/archive`, {});
export const deleteNotice = (id) => api('DELETE', `/notices/${id}`);
export const fetchNoticeRecipients = (id) => api('GET', `/notices/${id}/recipients`);
export const fetchNoticeAnalytics = (id) => api('GET', `/notices/${id}/analytics`);
export const uploadNoticeAttachment = (id, file) => apiUploadForm(`/notices/${id}/attachments`, { file });
export const deleteNoticeAttachment = (id, attId) => api('DELETE', `/notices/${id}/attachments/${attId}`);
export const downloadNoticeAttachment = (id, attId, fileName) => apiDownload(`/notices/${id}/attachments/${attId}/file`, fileName);
export const fetchMyNotices = (includeExpired) => api('GET', `/notices/me/list${includeExpired ? '?includeExpired=1' : ''}`);
export const fetchMyNoticesUnreadCount = () => api('GET', '/notices/me/unread-count');
export const fetchMyNotice = (id) => api('GET', `/notices/me/${id}`);
export const markMyNoticeRead = (id) => api('PUT', `/notices/me/${id}/read`, {});
export const acknowledgeMyNotice = (id) => api('PUT', `/notices/me/${id}/acknowledge`, {});
export const downloadMyNoticeAttachment = (id, attId, fileName) => apiDownload(`/notices/me/${id}/attachments/${attId}/file`, fileName);
export const fetchActivityStatus = () => api('GET', '/course-activity/status');
export const markCourseActivityViewedApi = (courseId) => api('PUT', `/course-activity/${courseId}/viewed`);

/** Generalized multipart upload — like apiUpload() but for multiple fields (a file plus form data),
    used for assignment submissions (an optional file plus an optional text response). An array
    value (e.g. multiple application documents) is appended multiple times under the same field
    name, which is how multer's upload.array() expects a repeated field to arrive. */
export async function apiUploadForm(path, fields, method = 'POST') {
  const token = getToken();
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => {
    if (Array.isArray(v)) { v.forEach(item => form.append(k, item)); return; }
    if (v !== undefined && v !== null && v !== '') form.append(k, v);
  });
  const res = await fetch(API_BASE + path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
export const submitAssignment = (id, { file, textResponse }) => apiUploadForm(`/assignments/${id}/submissions`, { file, textResponse });
/** The submission-file route requires an auth header, so a plain <a href> can't fetch it —
    goes through apiDownload() (fetch + blob "save file") just like the DB backup export. */
export const downloadSubmissionFile = (assignmentId, studentId, fileName) => apiDownload(`/assignments/${assignmentId}/submissions/${studentId}/file`, fileName);
export const fetchCourseMaterials = (courseId) => api('GET', `/materials?courseId=${courseId}`);
export const saveMaterial = ({ courseId, title, file }) => apiUploadForm('/materials', { courseId, title, file });
export const downloadMaterialFile = (materialId, fileName) => apiDownload(`/materials/${materialId}/file`, fileName);

/* ------------------------- Teacher (faculty) profile ------------------------- */
export const fetchTeacherProfile = (teacherId) => api('GET', `/teacher-profile/${teacherId}`);
export const saveTeacherProfile = (teacherId, data) => api('PUT', `/teacher-profile/${teacherId}`, data);
export const uploadTeacherPhoto = (teacherId, file) => apiUpload(`/teacher-profile/${teacherId}/photo`, 'photo', file);
/** The photo endpoint requires an auth header, so a plain <img src> can't fetch it (browsers
    don't attach custom headers to image requests) — this fetches it with the token and hands
    back an object URL the caller can drop straight into an <img>, or null if there's no photo
    on file yet. Caller is responsible for URL.revokeObjectURL() once done with it. */
export async function fetchTeacherPhotoUrl(teacherId) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/teacher-profile/${teacherId}/photo`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
export const addTeacherEducation = ({ teacherId, degree, fieldOfStudy, institution, country, startYear, year, gpa, notes, file, transcript }) =>
  apiUploadForm(`/teacher-profile/${teacherId}/education`, { degree, fieldOfStudy, institution, country, startYear, year, gpa, notes, file, transcript });
export const updateTeacherEducation = (id, fields) => apiUploadForm(`/teacher-profile/education/${id}`, fields, 'PUT');
export const deleteTeacherEducation = (id) => api('DELETE', `/teacher-profile/education/${id}`);
export const downloadTeacherEducationCertificate = (educationId, fileName) => apiDownload(`/teacher-profile/education/${educationId}/certificate`, fileName);
export const downloadTeacherEducationTranscript = (educationId, fileName) => apiDownload(`/teacher-profile/education/${educationId}/transcript`, fileName);

export const addTeacherExperience = ({ teacherId, ...fields }) => apiUploadForm(`/teacher-profile/${teacherId}/experience`, fields);
export const updateTeacherExperience = (id, fields) => apiUploadForm(`/teacher-profile/experience/${id}`, fields, 'PUT');
export const deleteTeacherExperience = (id) => api('DELETE', `/teacher-profile/experience/${id}`);
export const downloadTeacherExperienceDocument = (id, fileName) => apiDownload(`/teacher-profile/experience/${id}/document`, fileName);

export const addTeacherCertification = ({ teacherId, ...fields }) => apiUploadForm(`/teacher-profile/${teacherId}/certifications`, fields);
export const updateTeacherCertification = (id, fields) => apiUploadForm(`/teacher-profile/certifications/${id}`, fields, 'PUT');
export const deleteTeacherCertification = (id) => api('DELETE', `/teacher-profile/certifications/${id}`);
export const downloadTeacherCertificationDocument = (id, fileName) => apiDownload(`/teacher-profile/certifications/${id}/document`, fileName);

export const uploadTeacherDocument = ({ teacherId, docType, issueDate, expiryDate, file }) =>
  apiUploadForm(`/teacher-profile/${teacherId}/documents`, { docType, issueDate, expiryDate, file });
export const downloadTeacherDocument = (docId, fileName) => apiDownload(`/teacher-profile/documents/${docId}/file`, fileName);
export const deleteTeacherDocument = (id) => api('DELETE', `/teacher-profile/documents/${id}`);
/** kind: 'education' | 'experience' | 'certifications' | 'documents' — the four verifiable
    faculty record types, all sharing the same PUT .../:kind/:id/verify|reject shape. */
export const verifyTeacherEntity = (kind, id) => api('PUT', `/teacher-profile/${kind}/${id}/verify`);
export const rejectTeacherEntity = (kind, id, notes) => api('PUT', `/teacher-profile/${kind}/${id}/reject`, { notes });
export const fetchTeacherProfileSummaries = () => api('GET', '/teacher-profile');
export const deleteMaterial = (materialId) => api('DELETE', `/materials/${materialId}`);

export const fetchStudentProfile = (studentId) => api('GET', `/student-profile/${studentId}`);
/** The advisee roster for the logged-in Student Advisor (scoped server-side). */
export const fetchAdvisees = () => api('GET', '/student-profile/advisees');

// --- Students (canonical academic view: list + browse, distinct from the editable profile above) ---
/** Returns { items, total, page, pageSize } — server-side filtered/paginated. */
export const fetchStudents = (filters = {}) => {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return api('GET', `/students${qs ? `?${qs}` : ''}`);
};
/** Same filters as fetchStudents but unpaginated (capped server-side) — used for CSV export. */
export const fetchStudentsExport = (filters = {}) => {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return api('GET', `/students/export${qs ? `?${qs}` : ''}`);
};
export const bulkUpdateStudents = (studentIds, changes, reason) => api('PUT', '/students/bulk', { studentIds, changes, reason });
/** Application/enrollments/finance data for one student — the parts of the detail view the
    editable profile endpoint above doesn't already serve. */
export const fetchStudentOverview = (studentId) => api('GET', `/students/${studentId}/overview`);

// --- Finance ---
export const fetchFinanceSettings = () => api('GET', '/finance/settings');
export const saveFinanceSettings = (data) => api('PUT', '/finance/settings', data);
export const fetchFinanceStudents = (termId) => api('GET', `/finance/students${termId ? `?termId=${termId}` : ''}`);
export const fetchStudentStatement = (studentId, termId) => api('GET', `/finance/students/${studentId}${termId ? `?termId=${termId}` : ''}`);
export const recordPayment = (studentId, data) => api('POST', `/finance/students/${studentId}/payments`, data);
export const voidPayment = (paymentId) => api('DELETE', `/finance/payments/${paymentId}`);
export const fetchReceipt = (paymentId) => api('GET', `/finance/payments/${paymentId}/receipt`);
export const fetchMyFinance = (termId) => api('GET', `/finance/me${termId ? `?termId=${termId}` : ''}`);

/* ------------------------------- Finance: per-term config, charges, aid ------------------------------- */
export const fetchTermFeeConfig = (termId) => api('GET', `/finance/terms/${termId}/config`);
export const saveTermFeeConfig = (termId, data) => api('PUT', `/finance/terms/${termId}/config`, data);
export const createFeeItem = (termId, data) => api('POST', `/finance/terms/${termId}/fee-items`, data);
export const updateFeeItem = (id, data) => api('PUT', `/finance/fee-items/${id}`, data);
export const deleteFeeItem = (id) => api('DELETE', `/finance/fee-items/${id}`);
export const fetchFeeRules = (termId) => api('GET', `/finance/terms/${termId}/fee-rules`);
export const createFeeRule = (termId, data) => api('POST', `/finance/terms/${termId}/fee-rules`, data);
export const updateFeeRule = (id, data) => api('PUT', `/finance/fee-rules/${id}`, data);
export const deleteFeeRule = (id) => api('DELETE', `/finance/fee-rules/${id}`);
export const fetchFeePlan = (termId) => api('GET', `/finance/terms/${termId}/fee-plan`);
export const saveFeePlan = (termId, data) => api('PUT', `/finance/terms/${termId}/fee-plan`, data);
export const generateCharges = (termId) => api('POST', `/finance/terms/${termId}/generate-charges`, {});
export const previewCharge = (studentId, termId) => api('GET', `/finance/students/${studentId}/preview?termId=${termId}`);
export const awardAid = (studentId, data) => api('POST', `/finance/students/${studentId}/aid`, data);
export const reviseAid = (aidId, data) => api('PUT', `/finance/aid/${aidId}`, data);
export const revokeAid = (aidId) => api('DELETE', `/finance/aid/${aidId}`);

/* ------------------------------- Finance: Bursar overview aggregates ------------------------------- */
export const fetchReceivablesAging = (termId) => api('GET', `/finance/reports/aging${termId ? `?termId=${termId}` : ''}`);
export const fetchTodayCollections = (termId) => api('GET', `/finance/reports/today-collections${termId ? `?termId=${termId}` : ''}`);
export const fetchRecentFinancialActivity = (termId, limit) => api('GET', `/finance/reports/recent-activity?${termId ? `termId=${termId}&` : ''}limit=${limit || 15}`);
export const fetchFinanceTermSummary = (limit) => api('GET', `/finance/reports/term-summary${limit ? `?limit=${limit}` : ''}`);
export const fetchOverdueInstallments = (termId) => api('GET', `/finance/reports/overdue-installments${termId ? `?termId=${termId}` : ''}`);
export const fetchUpcomingInstallments = (termId, days) => api('GET', `/finance/reports/upcoming-installments?${termId ? `termId=${termId}&` : ''}days=${days || 30}`);
export const updateMyStudentProfile = (data) => api('PUT', '/student-profile/me', data);
export const updateStudentProfile = (studentId, data) => api('PUT', `/student-profile/${studentId}`, data);
export const uploadStudentDocument = (studentId, { documentType, title, file }) =>
  apiUploadForm(`/student-profile/${studentId}/documents`, { documentType, title, file });
export const downloadStudentDocument = (documentId, fileName) => apiDownload(`/student-profile/documents/${documentId}/file`, fileName);
export const deleteStudentDocument = (documentId) => api('DELETE', `/student-profile/documents/${documentId}`);
export const uploadStudentPhoto = (studentId, file) => apiUpload(`/student-profile/${studentId}/photo`, 'photo', file);
/** Same auth-header-via-blob-fetch approach as fetchTeacherPhotoUrl — a plain <img src> can't
    send the Authorization header this endpoint requires. Returns null if there's no photo yet. */
export async function fetchStudentPhotoUrl(studentId) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/student-profile/${studentId}/photo`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
export const fetchGraduationRequirement = () => api('GET', '/settings/graduation-requirement');
export const saveGraduationRequirement = (requiredCredits) => api('PUT', '/settings/graduation-requirement', { requiredCredits });

// --- Semester progression (automatic advancement + audited manual override) ---
export const fetchProgressionHistory = (studentId) => api('GET', `/progression/${studentId}/history`);
export const fetchCurrentProgression = (studentId) => api('GET', `/progression/${studentId}/current`);
export const evaluateProgression = (studentId) => api('POST', `/progression/${studentId}/evaluate`, {});
export const overrideProgression = (studentId, data) => api('POST', `/progression/${studentId}/override`, data);
export const evaluateTermProgression = (termId) => api('POST', `/progression/evaluate-term/${termId}`, {});
export const fetchProgressionPolicy = () => api('GET', '/settings/semester-progression-policy');
export const saveProgressionPolicy = (maxFailedCoursesForProgression) => api('PUT', '/settings/semester-progression-policy', { maxFailedCoursesForProgression });

/** Wipes operational data (courses, timetable, enrollments, students/teachers, exams,
    finance, admissions, notifications, ...) — see api/src/routes/superAdmin.js for exactly
    what's cleared vs. preserved. `confirmationPhrase` must be "RESET" or the institution
    name; the backend rejects anything else and never runs without it. */
export const runSystemReset = (confirmationPhrase, backupFirst) =>
  api('POST', '/super-admin/system-reset', { confirmationPhrase, backupFirst });

/** Public — no token is attached (none exists yet for an applicant). `documents` is an array of
    File objects, each appended under the same 'documents' field for multer's upload.array(). */
export const fetchPublicDepartments = () => api('GET', '/applications/departments');
export const submitApplication = ({ documents, ...fields }) => apiUploadForm('/applications', { ...fields, documents });
export const submitApplicationAsAdmin = (data) => api('POST', '/applications/admin', data);
export const fetchApplications = (filters = {}) => {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  return api('GET', `/applications${qs ? `?${qs}` : ''}`);
};
export const fetchApplication = (id) => api('GET', `/applications/${id}`);
export const updateApplication = (id, data) => api('PUT', `/applications/${id}`, data);
export const updateApplicationStatus = (id, data) => api('PUT', `/applications/${id}/status`, data);
export const approveApplication = (id, data) => api('POST', `/applications/${id}/approve`, data);
export const uploadApplicationDocument = (applicationId, { documentType, title, file }) =>
  apiUploadForm(`/applications/${applicationId}/documents`, { documentType, title, file });
export const downloadApplicationDocument = (applicationId, documentId, fileName) =>
  apiDownload(`/applications/${applicationId}/documents/${documentId}/file`, fileName);
export const deleteApplicationDocument = (applicationId, documentId) => api('DELETE', `/applications/${applicationId}/documents/${documentId}`);

/* ------------------------- Generic approval-chain engine ------------------------- */
/** type: 'appeal' today, more request types register on the backend over time — see
    api/src/approvalEngine.js. payload shape is type-specific. */
export const submitApprovalRequest = (type, payload) => api('POST', '/approvals', { type, payload });
export const fetchMyApprovalRequests = () => api('GET', '/approvals/mine');
export const fetchPendingApprovals = () => api('GET', '/approvals/pending');
export const decideApprovalRequest = (id, decision, note) => api('POST', `/approvals/${id}/decide`, { decision, note });
export const cancelApprovalRequest = (id) => api('POST', `/approvals/${id}/cancel`, {});
export const resubmitApprovalRequest = (id, payload) => api('POST', `/approvals/${id}/resubmit`, { payload });

/* ---------------------------- Custom report builder ---------------------------- */
/** Entity/field metadata (whitelist) that drives the builder's picker UI — see
    api/src/reportEntities.js. */
export const fetchReportEntities = () => api('GET', '/reports/entities');
/** Ad-hoc run against a whitelisted entity: config = {columns, filters, groupBy, aggregate, sort}. */
export const runReport = (entity, config) =>
  api('GET', `/reports/run?entity=${encodeURIComponent(entity)}&config=${encodeURIComponent(JSON.stringify(config))}`);
export const fetchReportDefinitions = () => api('GET', '/reports/definitions');
export const runReportDefinition = (id) => api('GET', `/reports/definitions/${id}/run`);
export const saveReportDefinition = (definition) => api('POST', '/reports/definitions', definition);
export const updateReportDefinition = (id, definition) => api('PUT', `/reports/definitions/${id}`, definition);
export const deleteReportDefinition = (id) => api('DELETE', `/reports/definitions/${id}`);

/** PDF/Excel export — server-rendered (api/src/reportExport.js), same reports:read scope as
    running the report. filename is chosen client-side since apiDownload() doesn't parse
    Content-Disposition. */
export const exportReportPdf = (entity, config, filename) =>
  apiDownload(`/reports/export/pdf?entity=${encodeURIComponent(entity)}&config=${encodeURIComponent(JSON.stringify(config))}`, filename);
export const exportReportXlsx = (entity, config, filename) =>
  apiDownload(`/reports/export/xlsx?entity=${encodeURIComponent(entity)}&config=${encodeURIComponent(JSON.stringify(config))}`, filename);
export const exportReportDefinitionPdf = (id, filename) => apiDownload(`/reports/definitions/${id}/export/pdf`, filename);
export const exportReportDefinitionXlsx = (id, filename) => apiDownload(`/reports/definitions/${id}/export/xlsx`, filename);
export const exportDashboardChartPdf = (chart, termId, filename) =>
  apiDownload(`/reports/export/dashboard/pdf?chart=${encodeURIComponent(chart)}${termId ? `&termId=${termId}` : ''}`, filename);
export const exportDashboardChartXlsx = (chart, termId, filename) =>
  apiDownload(`/reports/export/dashboard/xlsx?chart=${encodeURIComponent(chart)}${termId ? `&termId=${termId}` : ''}`, filename);

/* ---------------------------- Data Migration Center ---------------------------- */
export const fetchMigrationConnections = () => api('GET', '/migrations/connections');
export const saveMigrationConnection = (data, id) =>
  id ? api('PUT', `/migrations/connections/${id}`, data) : api('POST', '/migrations/connections', data);
export const deleteMigrationConnection = (id) => api('DELETE', `/migrations/connections/${id}`);
export const testMigrationConnection = (sourceType, config) => api('POST', '/migrations/connections/test', { sourceType, config });
export const testSavedMigrationConnection = (id) => api('POST', `/migrations/connections/${id}/test`);

export const fetchMigrationSourceTypes = () => api('GET', '/migrations/source-types');
export const fetchMigrationTargets = () => api('GET', '/migrations/targets');

export const fetchMigrations = () => api('GET', '/migrations');
export const fetchMigration = (id) => api('GET', `/migrations/${id}`);
export const createMigration = (data) => api('POST', '/migrations', data);
export const uploadMigrationSource = (file, { label, sourceType }) => apiUploadForm('/migrations/upload', { file, label, sourceType });

export const discoverMigration = (id) => api('POST', `/migrations/${id}/discover`, {});
export const fetchMigrationMapping = (id) => api('GET', `/migrations/${id}/mapping`);
export const saveMigrationMapping = (id, mappings) => api('POST', `/migrations/${id}/mapping`, mappings);
export const validateMigration = (id) => api('POST', `/migrations/${id}/validate`, {});
export const startMigrationDryRun = (id) => api('POST', `/migrations/${id}/dry-run`, {});
export const startMigrationImport = (id) => api('POST', `/migrations/${id}/import`, {});
export const fetchMigrationProgress = (id) => api('GET', `/migrations/${id}/progress`);
export const cancelMigration = (id) => api('POST', `/migrations/${id}/cancel`, {});
export const fetchMigrationReport = (id) => api('GET', `/migrations/${id}/report`);
export const rollbackMigration = (id) => api('POST', `/migrations/${id}/rollback`, {});

/* ---------------------- Graduation workflow and official registry ---------------------- */
const queryString = params => {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([,v]) => v !== '' && v != null));
  return q.size ? `?${q}` : '';
};
export const fetchGraduationCandidates = filters => api('GET', `/graduation/candidates${queryString(filters)}`);
export const fetchGraduationEligible = () => api('GET', '/graduation/eligible');
export const createGraduationApplication = data => api('POST', '/graduation/applications', data);
export const updateGraduationApplicationStatus = (id, status, reason) => api('PATCH', `/graduation/applications/${id}/status`, { status, reason });
export const runGraduationAudit = applicationId => api('POST', `/graduation/applications/${applicationId}/audit`, {});
export const finalizeGraduation = (applicationId, data = {}) => api('POST', `/graduation/applications/${applicationId}/finalize`, data);
export const fetchGraduatesRegistry = filters => api('GET', `/graduation/registry${queryString(filters)}`);
export const fetchGraduateDetail = id => api('GET', `/graduation/registry/${id}`);
export const updateGraduationIssuance = (id, type, data) => api('PATCH', `/graduation/registry/${id}/${type}`, data);
export const correctGraduationRecord = (id, data) => api('POST', `/graduation/registry/${id}/corrections`, data);
export const fetchGraduationReports = () => api('GET', '/graduation/reports');
export const fetchGraduationReconciliationPreview = () => api('GET', '/graduation/reconciliation/preview');
export const downloadGraduatesRegistry = filters => apiDownload(`/graduation/registry-export.xlsx${queryString(filters)}`, 'graduates-registry.xlsx');
export const downloadGraduationCertificate = (studentId, fileName) =>
  apiDownload(`/graduation/certificate/${studentId}`, fileName);
