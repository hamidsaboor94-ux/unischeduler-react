const { registerRequestType } = require('./approvalEngine');
const { get, run } = require('./db');
const { safeCreateNotification } = require('./notificationTypes');

registerRequestType('graduation', {
  subjectType: 'student',
  label: 'graduation application',
  chain: [
    { order: 1, role: 'dept_head', label: 'Department review' },
    { order: 2, role: 'registrar', label: 'Registrar review' },
    { order: 3, role: 'bursar', label: 'Finance and clearance verification' },
    { order: 4, role: 'records_officer', label: 'Final academic approval' },
  ],
  validatePayload: async (payload, { subjectId }) => {
    const applicationId = Number(payload?.graduationApplicationId);
    const application = await get('SELECT id, studentId, status FROM graduation_applications WHERE id = ?', [applicationId]);
    if (!application || Number(application.studentId) !== Number(subjectId)) {
      throw Object.assign(new Error('Graduation application not found.'), { status: 404 });
    }
    if (!['submitted', 'corrections_required'].includes(application.status)) {
      throw Object.assign(new Error('This graduation application cannot enter review.'), { status: 409 });
    }
    return { graduationApplicationId: application.id };
  },
  canAct: async (reviewer, request, step) => {
    if (reviewer.role === 'admin' || step.role !== 'dept_head') return true;
    const row = await get(
      `SELECT sp.departmentId,(SELECT departmentId FROM users WHERE id=?) reviewerDepartmentId FROM graduation_applications ga
       JOIN student_profiles sp ON sp.studentId = ga.studentId
       WHERE ga.id = ?`,
      [reviewer.sub, request.payload.graduationApplicationId]
    );
    return row?.departmentId != null && Number(row.departmentId) === Number(row.reviewerDepartmentId);
  },
  onDecision: async (request, reviewer, decision, note) => {
    const status = decision === 'reject' ? 'rejected' : decision === 'return' ? 'corrections_required' : 'under_review';
    await run(
      `UPDATE graduation_applications SET status=?,reviewedBy=?,reviewedAt=CURRENT_TIMESTAMP,
       decisionReason=?,updatedAt=CURRENT_TIMESTAMP WHERE id=?`,
      [status, reviewer.sub, note || null, request.payload.graduationApplicationId]
    );
    await safeCreateNotification({recipientUserId:Number(request.subjectId),type:'graduation_clearance_decision',title:'Graduation clearance updated',
      message:decision==='approve'?`A graduation clearance stage was approved.`:decision==='return'?`A graduation clearance stage requested corrections${note?`: ${note}`:'.'}`:`A graduation clearance stage was rejected${note?`: ${note}`:'.'}`,
      severity:decision==='approve'?'success':'warning',entityType:'graduation_application',entityId:request.payload.graduationApplicationId,
      actionSection:'student-profile',deduplicationKey:`graduation-clearance-decision:${request.id}:${request.currentStepOrder}:${decision}`,createdBy:reviewer.sub});
  },
  effect: async (request, decider) => {
    await run(
      `UPDATE graduation_applications SET status='approved', reviewedBy=?, reviewedAt=CURRENT_TIMESTAMP,
       updatedAt=CURRENT_TIMESTAMP WHERE id=?`,
      [decider.sub, request.payload.graduationApplicationId]
    );
  },
});
