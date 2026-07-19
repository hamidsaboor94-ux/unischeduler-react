// Inside Electron, preload.cjs exposes wherever that install's API actually is — its own
// embedded server on a random free port, or a shared server elsewhere on the network,
// depending on how that copy was configured (see electron/server-config.cjs). In the browser,
// VITE_API_BASE (set in a .env file, e.g. VITE_API_BASE=http://192.168.1.50:4000/api) points
// the website at a specific server; without it, it falls back to localhost:4000, matching
// `npm run dev` in the api package with no other configuration.
export const API_BASE = globalThis.UNISCHEDULER_API_BASE || import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

export async function api(method, path, body) {
  const token = localStorage.getItem('token');
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
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/** Multipart file upload variant of api() — used for the PDF timetable import parse endpoint. */
export async function apiUpload(path, fieldName, file) {
  const token = localStorage.getItem('token');
  const form = new FormData();
  form.append(fieldName, file);
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/** Authenticated file download — fetches `path` and hands the result to the browser
    as a "save file" of `filename`. Used for the database backup export. */
export async function apiDownload(path, filename) {
  const token = localStorage.getItem('token');
  const res = await fetch(API_BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON error body */ }
    throw new Error((data && data.error) || `Request failed (${res.status})`);
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
export const saveSlot = (data, id) => (id ? api('PUT', `/slots/${id}`, data) : api('POST', '/slots', data));
export const deleteSlot = (id) => api('DELETE', `/slots/${id}`);
export const saveSlotException = (data) => api('POST', '/slot-exceptions', data);
export const deleteSlotException = (id) => api('DELETE', `/slot-exceptions/${id}`);
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
export const fetchCourseAttendance = (courseId) => api('GET', `/attendance?courseId=${courseId}`);
export const fetchCourseRoster = (courseId) => api('GET', `/courses/${courseId}/roster`);
export const fetchMyAttendance = () => api('GET', '/attendance/me');
export const submitAttendance = (data) => api('POST', '/attendance/bulk', data);
export const saveExam = (data, id) => (id ? api('PUT', `/exams/${id}`, data) : api('POST', '/exams', data));
export const deleteExam = (id) => api('DELETE', `/exams/${id}`);
export const withdrawFromCourse = (enrollmentId) => api('DELETE', `/enrollments/${enrollmentId}`);
export const saveTerm = (data, id) => (id ? api('PUT', `/terms/${id}`, data) : api('POST', '/terms', data));
export const deleteTerm = (id) => api('DELETE', `/terms/${id}`);
export const saveDepartment = (data, id) => (id ? api('PUT', `/departments/${id}`, data) : api('POST', '/departments', data));
export const deleteDepartment = (id) => api('DELETE', `/departments/${id}`);
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
export const fetchGradingScale = () => api('GET', '/settings/grading-scale');
export const saveGradingScale = (bands) => api('PUT', '/settings/grading-scale', { bands });
export const fetchCourseAssignments = (courseId) => api('GET', `/assignments?courseId=${courseId}`);
export const saveAssignment = (data) => api('POST', '/assignments', data);
export const fetchAssignmentSubmissions = (id) => api('GET', `/assignments/${id}/submissions`);
export const gradeSubmission = (assignmentId, studentId, data) => api('PUT', `/assignments/${assignmentId}/submissions/${studentId}`, data);
export const fetchCourseAnnouncements = (courseId) => api('GET', `/announcements?courseId=${courseId}`);
export const saveAnnouncement = (data) => api('POST', '/announcements', data);
export const fetchActivityStatus = () => api('GET', '/course-activity/status');
export const markCourseActivityViewedApi = (courseId) => api('PUT', `/course-activity/${courseId}/viewed`);

/** Generalized multipart upload — like apiUpload() but for multiple fields (a file plus form data),
    used for assignment submissions (an optional file plus an optional text response). An array
    value (e.g. multiple application documents) is appended multiple times under the same field
    name, which is how multer's upload.array() expects a repeated field to arrive. */
export async function apiUploadForm(path, fields) {
  const token = localStorage.getItem('token');
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => {
    if (Array.isArray(v)) { v.forEach(item => form.append(k, item)); return; }
    if (v !== undefined && v !== null && v !== '') form.append(k, v);
  });
  const res = await fetch(API_BASE + path, {
    method: 'POST',
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

export const fetchStudentProfile = (studentId) => api('GET', `/student-profile/${studentId}`);
export const updateMyStudentProfile = (data) => api('PUT', '/student-profile/me', data);
export const updateStudentProfile = (studentId, data) => api('PUT', `/student-profile/${studentId}`, data);
export const uploadStudentDocument = (studentId, { documentType, title, file }) =>
  apiUploadForm(`/student-profile/${studentId}/documents`, { documentType, title, file });
export const downloadStudentDocument = (documentId, fileName) => apiDownload(`/student-profile/documents/${documentId}/file`, fileName);
export const deleteStudentDocument = (documentId) => api('DELETE', `/student-profile/documents/${documentId}`);
export const fetchGraduationRequirement = () => api('GET', '/settings/graduation-requirement');
export const saveGraduationRequirement = (requiredCredits) => api('PUT', '/settings/graduation-requirement', { requiredCredits });

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
