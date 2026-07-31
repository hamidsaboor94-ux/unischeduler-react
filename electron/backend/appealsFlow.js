/**
 * Registers 'appeal' — the approval-chain engine's first real request type (see
 * approvalEngine.js). A student appeals a specific course outcome; their instructor reviews
 * first, then the registrar makes the final call. Required at server startup (see index.js) so
 * the type exists before any request touches routes/approvals.js.
 */
const { get } = require('./db');
const { registerRequestType } = require('./approvalEngine');
const { canManageCourse } = require('./ownership');

const REASON_MAX_LENGTH = 2000;

async function validatePayload(payload, { subjectId }) {
  const courseId = Number(payload?.courseId);
  const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
  if (!Number.isInteger(courseId)) throw Object.assign(new Error('A course must be selected.'), { status: 400 });
  if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
  const enrollment = await get(`SELECT id FROM enrollments WHERE studentId = ? AND courseId = ?`, [subjectId, courseId]);
  if (!enrollment) throw Object.assign(new Error('You may only appeal a course you were enrolled in.'), { status: 400 });
  const course = await get('SELECT id, code, name FROM courses WHERE id = ?', [courseId]);
  if (!course) throw Object.assign(new Error('Course not found.'), { status: 404 });
  return { courseId, courseCode: course.code, courseName: course.name, reason: reason.slice(0, REASON_MAX_LENGTH) };
}

registerRequestType('appeal', {
  subjectType: 'student',
  label: 'academic appeal',
  chain: [
    { order: 1, role: 'faculty', label: 'Instructor review' },
    { order: 2, role: 'registrar', label: 'Registrar decision' },
  ],
  validatePayload,
  // Step 1 is restricted to the actual instructor of the appealed course — being "faculty" alone
  // isn't enough, same ownership rule as every other faculty-scoped action in this app
  // (canManageCourse — see ownership.js). Step 2 (registrar) has no extra restriction: any
  // registrar (or admin) may take the final call.
  async canAct(reviewer, request, step) {
    if (step.role !== 'faculty') return true;
    const course = await get('SELECT id, teacherId, departmentId FROM courses WHERE id = ?', [request.payload?.courseId]);
    return canManageCourse({ user: reviewer }, course);
  },
  // No automated system effect on approval — unlike leave/graduation/aid, an appeal's actual
  // remedy (grade correction, reinstatement, ...) is whatever the reviewers decided in their
  // notes and is carried out manually through the normal gradebook/enrollment tools, by whoever
  // is already authorized to make that change. The engine's own audit log + notification (see
  // approvalEngine.js's decide()) is the complete record of the decision itself.
  async effect() {},
});
