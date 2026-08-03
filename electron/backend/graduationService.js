const { all, get, run, transaction, logAudit } = require('./db');
const { studentAudit } = require('./curriculum');
const { computeStudentTotals } = require('./finance');
const { createRequest } = require('./approvalEngine');
const { safeCreateNotification, createBulkNotifications } = require('./notificationTypes');
require('./graduationFlow');

const APPLICATION_STATUSES = new Set(['submitted', 'under_review', 'corrections_required', 'approved', 'rejected', 'withdrawn', 'finalized']);
const CERTIFICATE_STATUSES = new Set(['not_generated', 'generated', 'printed', 'issued', 'collected', 'withheld', 'revoked']);
const TRANSCRIPT_STATUSES = new Set(['pending', 'ready', 'issued', 'collected', 'withheld']);
const RECORD_STATUSES = new Set(['active', 'corrected', 'revoked']);

function fail(status, message, code, details) {
  return Object.assign(new Error(message), { status, code, details });
}

function parseJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

async function currentStudentProgram(studentId) {
  return get(
    `SELECT spr.*, p.name programName, p.degreeLevel, p.totalCredits, d.id departmentId,
            d.name departmentName, col.id collegeId, col.name collegeName
     FROM student_programs spr JOIN programs p ON p.id=spr.programId
     LEFT JOIN departments d ON d.id=p.departmentId LEFT JOIN colleges col ON col.id=d.collegeId
     WHERE spr.studentId=? AND spr.status IN ('active','on_leave','suspended') ORDER BY spr.id DESC LIMIT 1`,
    [studentId]
  );
}

async function createCurrentStudentProgram(studentId, actor) {
  const existing = await currentStudentProgram(studentId);
  if (existing) return existing;
  const profile = await get('SELECT programId, enrollmentDate, studentStatus FROM student_profiles WHERE studentId=?', [studentId]);
  if (!profile?.programId) throw fail(422, 'The student has no assigned program.', 'NO_PROGRAM');
  if (String(profile.studentStatus).toLowerCase() === 'graduated') {
    throw fail(409, 'Legacy graduated records require reconciliation review; they cannot be silently converted.', 'LEGACY_RECONCILIATION_REQUIRED');
  }
  const inserted = await run(
    `INSERT INTO student_programs(studentId,programId,admissionDate,status,createdBy) VALUES(?,?,?,'active',?)`,
    [studentId, profile.programId, profile.enrollmentDate || null, actor.sub]
  );
  await logAudit(actor, 'student-program-create-for-graduation', 'student_programs', inserted.id,
    { reason: 'Explicit graduation application workflow' }, null, { studentId, programId: profile.programId, status: 'active' });
  return currentStudentProgram(studentId);
}

async function graduationAudit(studentId, { applicationId = null, actor = null, purpose = 'evaluation', store = false } = {}) {
  const [student, profile, programAttempt, curriculumAudit, finance, genericHolds, activeRegistrations, minimumGpaRow] = await Promise.all([
    get('SELECT id,name,idNumber,email FROM users WHERE id=? AND role=\'student\'', [studentId]),
    get('SELECT * FROM student_profiles WHERE studentId=?', [studentId]),
    currentStudentProgram(studentId),
    studentAudit(studentId),
    computeStudentTotals(studentId),
    all('SELECT id,type,reason,createdAt FROM holds WHERE studentId=? AND active=1 ORDER BY type', [studentId]),
    all(`SELECT e.id,c.code,c.name,t.name termName FROM enrollments e JOIN courses c ON c.id=e.courseId
         LEFT JOIN terms t ON t.id=c.termId WHERE e.studentId=? AND e.status IN ('enrolled','waitlisted') AND e.grade IS NULL AND e.deletedAt IS NULL`, [studentId]),
    get("SELECT value FROM settings WHERE key='graduationMinimumGpa'"),
  ]);
  if (!student || !profile) throw fail(404, 'Student not found.');
  const minimumGpa = minimumGpaRow?.value === undefined || minimumGpaRow?.value === '' ? null : Number(minimumGpaRow.value);
  const app = applicationId ? await get('SELECT * FROM graduation_applications WHERE id=? AND studentId=?', [applicationId, studentId]) : null;
  const curriculumId = curriculumAudit.curriculum?.id || null;
  const configuredRequirements = curriculumId
    ? await all('SELECT * FROM graduation_requirements WHERE curriculumId=? AND required=1 ORDER BY requirementType', [curriculumId]) : [];
  const requirementResults = app
    ? await all('SELECT * FROM graduation_requirement_results WHERE graduationApplicationId=?', [app.id]) : [];
  const resultByType = new Map(requirementResults.map(r => [r.requirementType, r]));
  const specialRequirements = configuredRequirements.map(r => ({
    type: r.requirementType, label: r.label, status: resultByType.get(r.requirementType)?.status || 'pending',
    evidence: resultByType.get(r.requirementType)?.evidence || null,
    satisfied: resultByType.get(r.requirementType)?.status === 'completed',
  }));
  const financeHold = finance.balance > 0.004 ? { type: 'financial', reason: `Outstanding balance of ${finance.balance}` } : null;
  const holds = [...genericHolds, ...(financeHold ? [financeHold] : [])];
  const reasons = [];
  const add = (code, message, category, details) => reasons.push({ code, message, category, details: details || null });
  if (!programAttempt) add('NO_STUDENT_PROGRAM', 'No explicit student-program record exists.', 'academic');
  if (!curriculumAudit.curriculum) add('NO_CURRICULUM', 'No curriculum version is assigned.', 'academic');
  for (const c of curriculumAudit.missingRequired || []) add('REQUIRED_COURSE_MISSING', `${c.code || c.name} is not completed at the required grade.`, 'academic', c);
  for (const g of (curriculumAudit.electiveGroups || []).filter(x => !x.satisfied)) add('ELECTIVE_REQUIREMENT_MISSING', `${g.name} is incomplete.`, 'academic', g);
  if (Number(curriculumAudit.remainingCredits || 0) > 0) add('INSUFFICIENT_CREDITS', `${curriculumAudit.remainingCredits} credits remain.`, 'academic');
  for (const c of curriculumAudit.missingGrades || []) add('MISSING_GRADE', `${c.code || c.name} has no final grade.`, 'academic', c);
  for (const c of curriculumAudit.missingPrerequisites || []) add('PREREQUISITE_CHAIN_ISSUE', `${c.targetName || 'A completed course'} has an unmet prerequisite.`, 'academic', c);
  if (minimumGpa == null) add('GPA_POLICY_NOT_CONFIGURED', 'The minimum graduation GPA policy is not configured.', 'policy');
  else if (curriculumAudit.gpa == null || Number(curriculumAudit.gpa) < minimumGpa) add('LOW_GPA', `GPA ${curriculumAudit.gpa ?? 'N/A'} is below the required ${minimumGpa}.`, 'academic');
  for (const h of holds) add('ACTIVE_HOLD', `${h.type} hold: ${h.reason || 'No reason recorded'}`, 'clearance', h);
  for (const r of activeRegistrations) add('ACTIVE_REGISTRATION', `${r.code || r.name} is still active without a final grade.`, 'academic', r);
  if (['Suspended', 'Withdrawn'].includes(profile.studentStatus) || profile.enrollmentStatus === 'Probation') add('ACADEMIC_STANDING', `Academic standing is ${profile.studentStatus || profile.enrollmentStatus}.`, 'academic');
  for (const r of specialRequirements.filter(x => !x.satisfied)) add('SPECIAL_REQUIREMENT', `${r.label} is not verified as completed.`, 'academic', r);
  const onlyConditional = reasons.length > 0 && reasons.every(r => ['ACTIVE_REGISTRATION', 'MISSING_GRADE'].includes(r.code));
  const result = reasons.length === 0 ? 'eligible' : onlyConditional ? 'conditionally_eligible' : 'ineligible';
  const audit = {
    student, profile: { programSemester: profile.programSemester, studentStatus: profile.studentStatus, enrollmentStatus: profile.enrollmentStatus },
    studentProgram: programAttempt, applicationId: app?.id || null, curriculum: curriculumAudit.curriculum || null,
    academic: {
      requiredCompleted: curriculumAudit.completedRequired || [], requiredMissing: curriculumAudit.missingRequired || [],
      electiveGroups: curriculumAudit.electiveGroups || [], completedCredits: curriculumAudit.completedCredits || 0,
      requiredCredits: curriculumAudit.curriculum?.totalRequiredCredits || 0, creditsRemaining: curriculumAudit.remainingCredits || 0,
      gpa: curriculumAudit.gpa, minimumGpa, failedRequired: (curriculumAudit.missingRequired || []).filter(x => x.grade),
      missingGrades: curriculumAudit.missingGrades || [], prerequisiteIssues: curriculumAudit.missingPrerequisites || [],
      activeRegistrations, specialRequirements,
    },
    clearances: {
      financial: { cleared: !financeHold, balance: finance.balance },
      library: { cleared: !holds.some(h => h.type === 'library') }, department: { cleared: !holds.some(h => h.type === 'department') },
      dormitory: { cleared: !holds.some(h => h.type === 'dormitory') }, disciplinary: { cleared: !holds.some(h => h.type === 'disciplinary') },
      administrative: { cleared: !holds.some(h => h.type === 'administrative') }, holds,
    },
    result, eligible: result === 'eligible', reasons, evaluatedAt: new Date().toISOString(),
  };
  if (store) {
    const inserted = await run(
      `INSERT INTO graduation_audits(studentId,studentProgramId,graduationApplicationId,result,snapshot,purpose,evaluatedBy)
       VALUES(?,?,?,?,?,?,?)`,
      [studentId, programAttempt?.id || app?.studentProgramId || null, app?.id || null, result, JSON.stringify(audit), purpose, actor?.sub || null]
    );
    if (app) await run('UPDATE graduation_applications SET lastEvaluatedAt=CURRENT_TIMESTAMP,updatedAt=CURRENT_TIMESTAMP WHERE id=?', [app.id]);
    if (actor) await logAudit(actor, 'graduation-audit-run', 'graduation_audits', inserted.id, { purpose }, null, { studentId, applicationId: app?.id || null, result, reasons: reasons.map(r => r.code) });
    audit.auditId = inserted.id;
  }
  return audit;
}

async function listPotentialCandidates(query = {}) {
  const clauses = ["u.role='student'", "COALESCE(sp.studentStatus,'Active')!='Graduated'"];
  const params = [];
  for (const [key, column] of [['programId','sp.programId'], ['departmentId','sp.departmentId']]) if (query[key]) { clauses.push(`${column}=?`); params.push(query[key]); }
  if (query.collegeId) { clauses.push('d.collegeId=?'); params.push(query.collegeId); }
  const students = await all(
    `SELECT u.id studentId,u.name,u.idNumber,sp.programId,sp.departmentId,sp.programSemester,sp.studentStatus,
            p.name programName,d.name departmentName,col.name collegeName
     FROM users u JOIN student_profiles sp ON sp.studentId=u.id LEFT JOIN programs p ON p.id=sp.programId
     LEFT JOIN departments d ON d.id=sp.departmentId LEFT JOIN colleges col ON col.id=d.collegeId
     WHERE ${clauses.join(' AND ')} ORDER BY u.name`, params
  );
  const out = [];
  for (const row of students) {
    // Candidate detection is advisory and therefore does not store snapshots or create program rows.
    // eslint-disable-next-line no-await-in-loop
    const audit = await graduationAudit(row.studentId);
    const application = await get('SELECT * FROM graduation_applications WHERE studentId=? ORDER BY id DESC LIMIT 1', [row.studentId]);
    if (query.eligibilityStatus && audit.result !== query.eligibilityStatus) continue;
    if (query.applicationStatus && application?.status !== query.applicationStatus) continue;
    if (query.holdsPresent === 'true' && !audit.clearances.holds.length) continue;
    if (query.expectedGraduationTermId && Number(application?.expectedGraduationTermId) !== Number(query.expectedGraduationTermId)) continue;
    if (query.academicYear && !String(audit.curriculum?.catalogYear || audit.curriculum?.academicYear || '').includes(String(query.academicYear))) continue;
    if (query.gpaMin !== undefined && query.gpaMin !== '' && Number(audit.academic.gpa) < Number(query.gpaMin)) continue;
    if (query.gpaMax !== undefined && query.gpaMax !== '' && Number(audit.academic.gpa) > Number(query.gpaMax)) continue;
    if (query.missingRequirements === 'true' && audit.reasons.length === 0) continue;
    out.push({ ...row, curriculumName: audit.curriculum?.name || audit.curriculum?.curriculumName || null,
      completedCredits: audit.academic.completedCredits, requiredCredits: audit.academic.requiredCredits, gpa: audit.academic.gpa,
      missingRequiredCount: audit.academic.requiredMissing.length, missingElectiveCount: audit.academic.electiveGroups.filter(g => !g.satisfied).length,
      holds: audit.clearances.holds, eligibilityStatus: audit.result, application, lastEvaluatedAt: application?.lastEvaluatedAt || audit.evaluatedAt });
  }
  return out;
}

async function createApplication(studentId, data, actor) {
  const studentProgram = await createCurrentStudentProgram(studentId, actor);
  try {
    const inserted = await run(
      `INSERT INTO graduation_applications(studentId,studentProgramId,expectedGraduationTermId,applicationDate,status,submittedBy,notes)
       VALUES(?,?,?,DATE('now'),'submitted',?,?)`,
      [studentId, studentProgram.id, data.expectedGraduationTermId || null, actor.sub, data.notes || null]
    );
    const request = await createRequest('graduation', { subjectId: Number(studentId), requestedBy: actor.sub, payload: { graduationApplicationId: inserted.id } });
    await run(`UPDATE graduation_applications SET approvalRequestId=?,status='under_review',updatedAt=CURRENT_TIMESTAMP WHERE id=?`, [request.id, inserted.id]);
    const row = await get('SELECT * FROM graduation_applications WHERE id=?', [inserted.id]);
    await logAudit(actor, 'graduation-application-submit', 'graduation_applications', inserted.id, null, null, row);
    await safeCreateNotification({recipientUserId:Number(studentId),type:'graduation_clearance_started',title:'Graduation clearance started',
      message:'Your graduation application entered the formal clearance and approval workflow.',severity:'info',entityType:'graduation_application',entityId:inserted.id,
      actionSection:'student-profile',deduplicationKey:`graduation-clearance:${inserted.id}`,createdBy:actor.sub});
    const staff=await all(`SELECT id FROM users WHERE role IN ('registrar','records_officer','dept_head','bursar')`);
    await createBulkNotifications({recipientUserIds:staff.map(x=>x.id),type:'approval_queue_entered',title:'Graduation application requires review',
      message:'A graduation application entered the approval workflow.',severity:'info',entityType:'graduation_application',entityId:inserted.id,
      actionSection:'approvals',deduplicationKeyPrefix:`graduation-review:${inserted.id}`,createdBy:actor.sub});
    return { ...row, approvalRequest: request };
  } catch (err) {
    if (String(err.message).includes('uq_graduation_application_active')) throw fail(409, 'An active application already exists for this program and term.', 'DUPLICATE_APPLICATION');
    throw err;
  }
}

async function updateApplicationStatus(id, status, reason, actor) {
  if (!APPLICATION_STATUSES.has(status) || !['corrections_required','rejected','withdrawn'].includes(status)) throw fail(400, 'Invalid manual application status.');
  if (!String(reason || '').trim()) throw fail(400, 'A reason is required.');
  const old = await get('SELECT * FROM graduation_applications WHERE id=?', [id]);
  if (!old) throw fail(404, 'Application not found.');
  if (['finalized','withdrawn'].includes(old.status)) throw fail(409, 'This application is closed.');
  await run(`UPDATE graduation_applications SET status=?,decisionReason=?,reviewedBy=?,reviewedAt=CURRENT_TIMESTAMP,updatedAt=CURRENT_TIMESTAMP WHERE id=?`, [status, reason.trim(), actor.sub, id]);
  const next = await get('SELECT * FROM graduation_applications WHERE id=?', [id]);
  await logAudit(actor, `graduation-application-${status}`, 'graduation_applications', Number(id), { reason }, old, next);
  return next;
}

function graduateNumber(recordId, date) { return `GR-${String(date).slice(0,4)}-${String(recordId).padStart(6,'0')}`; }
function certificateNumber(recordId, date) { return `CERT-${String(date).slice(0,4)}-${String(recordId).padStart(6,'0')}`; }

async function finalizeGraduation(applicationId, data, actor) {
  const outcome=await transaction(async () => {
    const app = await get(
      `SELECT ga.*,ar.status approvalStatus FROM graduation_applications ga
       LEFT JOIN approval_requests ar ON ar.id=ga.approvalRequestId WHERE ga.id=?`, [applicationId]
    );
    if (!app) throw fail(404, 'Graduation application not found.');
    const existing = await get('SELECT * FROM graduation_records WHERE studentProgramId=?', [app.studentProgramId]);
    if (existing) return { record: existing, alreadyFinalized: true };
    if (app.status !== 'approved' || app.approvalStatus !== 'Approved') throw fail(409, 'Every approval stage must be complete before finalization.', 'APPROVALS_INCOMPLETE');
    const audit = await graduationAudit(app.studentId, { applicationId: app.id, actor, purpose: 'finalization', store: true });
    if (!audit.eligible) throw fail(422, 'Final graduation validation failed.', 'GRADUATION_INELIGIBLE', audit);
    const officialDate = data.officialGraduationDate || new Date().toISOString().slice(0,10);
    const degree = data.degreeAwarded || (audit.studentProgram.degreeLevel ? `${audit.studentProgram.degreeLevel} in ${audit.studentProgram.programName}` : audit.studentProgram.programName);
    const inserted = await run(
      `INSERT INTO graduation_records(studentId,studentProgramId,programId,curriculumId,graduationApplicationId,graduationTermId,
       degreeAwarded,graduationDate,completionDate,officialGraduationDate,finalGpa,totalCreditsCompleted,honorsOrDistinction,
       thesisTitle,conferredBy,certificateNumber,certificateStatus,transcriptStatus,approvedBy,approvedAt,finalizedBy,finalizedAt,
       recordStatus,status,notes,graduateNumber,updatedAt)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'active','Active',?,'PENDING',CURRENT_TIMESTAMP)`,
      [app.studentId,app.studentProgramId,audit.studentProgram.programId,audit.curriculum?.id || null,app.id,app.expectedGraduationTermId || null,
       degree,officialDate,data.completionDate || officialDate,officialDate,audit.academic.gpa,audit.academic.completedCredits,
       data.honorsOrDistinction || null,data.thesisTitle || null,actor.sub,`PENDING-${app.studentId}-${Date.now()}`,'not_generated','pending',
       app.reviewedBy || actor.sub,app.reviewedAt || new Date().toISOString(),actor.sub,data.notes || null]
    );
    const gradNo = graduateNumber(inserted.id, officialDate), certNo = certificateNumber(inserted.id, officialDate);
    await run('UPDATE graduation_records SET graduateNumber=?,certificateNumber=? WHERE id=?', [gradNo, certNo, inserted.id]);
    await run(`UPDATE graduation_audits SET graduationRecordId=? WHERE id=?`, [inserted.id, audit.auditId]);
    await run(`UPDATE graduation_applications SET status='finalized',updatedAt=CURRENT_TIMESTAMP WHERE id=?`, [app.id]);
    await run(`UPDATE student_programs SET status='graduated',updatedAt=CURRENT_TIMESTAMP WHERE id=?`, [app.studentProgramId]);
    await run(`UPDATE student_profiles SET studentStatus='Graduated',semesterStatus='Completed',graduationStatus='Conferred',graduationDate=?,degreeAwarded=?,updatedAt=CURRENT_TIMESTAMP WHERE studentId=?`, [officialDate,degree,app.studentId]);
    await run(`UPDATE semester_records SET status='Completed',completedAt=COALESCE(completedAt,CURRENT_TIMESTAMP) WHERE studentId=? AND status IN ('In Progress','Awaiting Results','On Hold','Graduation Eligible')`, [app.studentId]);
    const record = await get('SELECT * FROM graduation_records WHERE id=?', [inserted.id]);
    await logAudit(actor, 'graduation-finalize', 'graduation_records', inserted.id,
      { graduateNumber: gradNo, applicationId: app.id, auditId: audit.auditId }, null, record);
    return { record, audit, alreadyFinalized: false };
  });
  if(!outcome.alreadyFinalized){
    await safeCreateNotification({recipientUserId:outcome.record.studentId,type:'graduation_finalized',title:'Graduation formally confirmed',
      message:`Your ${outcome.record.degreeAwarded} has been formally awarded. Graduate number: ${outcome.record.graduateNumber}.`,severity:'success',
      entityType:'graduation_record',entityId:outcome.record.id,actionSection:'student-profile',deduplicationKey:`graduation-finalized:${outcome.record.id}`,createdBy:actor.sub});
  }
  return outcome;
}

function registryFilters(query) {
  const clauses = ["gr.finalizedAt IS NOT NULL"];
  const params = [];
  const exact = { graduationTermId:'gr.graduationTermId', programId:'gr.programId', departmentId:'p.departmentId', collegeId:'d.collegeId', curriculumId:'gr.curriculumId', certificateStatus:'gr.certificateStatus', transcriptStatus:'gr.transcriptStatus', recordStatus:'gr.recordStatus', degreeAwarded:'gr.degreeAwarded', degreeClassification:'gr.degreeClassification', honorsOrDistinction:'gr.honorsOrDistinction' };
  for (const [key,col] of Object.entries(exact)) if (query[key]) { clauses.push(`${col}=?`); params.push(query[key]); }
  if (query.year) { clauses.push("substr(gr.officialGraduationDate,1,4)=?"); params.push(String(query.year)); }
  if (query.search) { clauses.push('(gr.graduateNumber LIKE ? OR u.idNumber LIKE ? OR u.name LIKE ?)'); const s=`%${query.search}%`; params.push(s,s,s); }
  return { clauses, params };
}

async function listRegistry(query = {}) {
  const page=Math.max(1,Number(query.page)||1), pageSize=Math.min(query.export===true?5000:100,Math.max(1,Number(query.pageSize)||25));
  const allowedSort = { graduateNumber:'gr.graduateNumber', name:'u.name', officialGraduationDate:'gr.officialGraduationDate', finalGpa:'gr.finalGpa', program:'p.name' };
  const sort=allowedSort[query.sort]||'gr.officialGraduationDate', direction=String(query.direction).toLowerCase()==='asc'?'ASC':'DESC';
  const {clauses,params}=registryFilters(query), where=clauses.join(' AND ');
  const base=`FROM graduation_records gr JOIN users u ON u.id=gr.studentId LEFT JOIN student_programs spr ON spr.id=gr.studentProgramId
    LEFT JOIN programs p ON p.id=gr.programId LEFT JOIN departments d ON d.id=p.departmentId LEFT JOIN colleges col ON col.id=d.collegeId
    LEFT JOIN curriculum c ON c.id=gr.curriculumId LEFT JOIN terms t ON t.id=gr.graduationTermId`;
  const total=(await get(`SELECT COUNT(*) n ${base} WHERE ${where}`,params)).n;
  const items=await all(`SELECT gr.*,u.name,u.idNumber,u.email,p.name programName,p.degreeLevel,d.name departmentName,col.name collegeName,
    COALESCE(c.catalogYear,c.academicYear) curriculumVersion,t.name graduationTerm,spr.admissionDate ${base} WHERE ${where}
    ORDER BY ${sort} ${direction},gr.id DESC LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]);
  return {items,total,page,pageSize};
}

async function getGraduate(id) {
  const row = await get(
    `SELECT gr.*,u.name,u.idNumber,u.email,p.name programName,p.degreeLevel,d.name departmentName,col.name collegeName,
     COALESCE(c.catalogYear,c.academicYear) curriculumVersion,t.name graduationTerm,spr.admissionDate
     FROM graduation_records gr JOIN users u ON u.id=gr.studentId LEFT JOIN student_programs spr ON spr.id=gr.studentProgramId
     LEFT JOIN programs p ON p.id=gr.programId LEFT JOIN departments d ON d.id=p.departmentId LEFT JOIN colleges col ON col.id=d.collegeId
     LEFT JOIN curriculum c ON c.id=gr.curriculumId LEFT JOIN terms t ON t.id=gr.graduationTermId
     WHERE gr.id=? AND gr.finalizedAt IS NOT NULL`, [id]
  );
  if (!row) throw fail(404, 'Graduate record not found.');
  const [audits, application, approval, issuance, corrections] = await Promise.all([
    all('SELECT id,result,purpose,snapshot,createdAt,evaluatedBy FROM graduation_audits WHERE graduationRecordId=? ORDER BY id DESC', [id]),
    row.graduationApplicationId ? get('SELECT * FROM graduation_applications WHERE id=?', [row.graduationApplicationId]) : null,
    row.graduationApplicationId ? get(`SELECT ar.* FROM approval_requests ar JOIN graduation_applications ga ON ga.approvalRequestId=ar.id WHERE ga.id=?`, [row.graduationApplicationId]) : null,
    all('SELECT * FROM graduation_issuance_events WHERE graduationRecordId=? ORDER BY id DESC', [id]),
    all('SELECT * FROM graduation_corrections WHERE graduationRecordId=? ORDER BY id DESC', [id]),
  ]);
  let approvalHistory=[];
  if (approval) approvalHistory=await all(`SELECT ad.*,u.name reviewerName,acs.label FROM approval_decisions ad JOIN users u ON u.id=ad.reviewerId LEFT JOIN approval_chain_steps acs ON acs.type='graduation' AND acs.stepOrder=ad.stepOrder WHERE ad.requestId=? ORDER BY ad.id`,[approval.id]);
  return {...row,audits:audits.map(a=>({...a,snapshot:parseJson(a.snapshot,{})})),application,approval:approval?{...approval,history:approvalHistory}:null,issuance,corrections};
}

async function updateIssuance(id, documentType, data, actor) {
  const allowed=documentType==='certificate'?CERTIFICATE_STATUSES:documentType==='transcript'?TRANSCRIPT_STATUSES:null;
  if (!allowed || !allowed.has(data.status)) throw fail(400,'Invalid document status.');
  const record=await get('SELECT * FROM graduation_records WHERE id=? AND finalizedAt IS NOT NULL',[id]);
  if(!record) throw fail(404,'Graduate record not found.');
  if (['withheld','revoked'].includes(data.status) && !String(data.reason||'').trim()) throw fail(400,'A reason is required.');
  const statusCol=documentType==='certificate'?'certificateStatus':'transcriptStatus';
  const issuedCol=documentType==='certificate'?'certificateIssuedAt':'transcriptIssuedAt';
  const issuedAt=['issued','collected'].includes(data.status)?'CURRENT_TIMESTAMP':issuedCol;
  await run(`UPDATE graduation_records SET ${statusCol}=?,${issuedCol}=${issuedAt},updatedAt=CURRENT_TIMESTAMP WHERE id=?`,[data.status,id]);
  const event=await run(`INSERT INTO graduation_issuance_events(graduationRecordId,documentType,status,reason,notes,actedBy,collectedBy) VALUES(?,?,?,?,?,?,?)`,[id,documentType,data.status,data.reason||null,data.notes||null,actor.sub,data.collectedBy||null]);
  await logAudit(actor,`graduation-${documentType}-${data.status}`,'graduation_records',Number(id),{reason:data.reason||null,eventId:event.id},{[statusCol]:record[statusCol]},{[statusCol]:data.status});
  return getGraduate(id);
}

async function correctRecord(id, data, actor) {
  const allowed=new Set(['officialGraduationDate','completionDate','degreeClassification','honorsOrDistinction','thesisTitle','notes']);
  const fields=Object.keys(data.changes||{}).filter(k=>allowed.has(k));
  if(!fields.length||!String(data.reason||'').trim()) throw fail(400,'An authorized correction and reason are required.');
  const old=await get('SELECT * FROM graduation_records WHERE id=?',[id]); if(!old) throw fail(404,'Graduate record not found.');
  await transaction(async()=>{for(const field of fields){await run(`UPDATE graduation_records SET ${field}=?,recordStatus='corrected',updatedAt=CURRENT_TIMESTAMP WHERE id=?`,[data.changes[field],id]);await run(`INSERT INTO graduation_corrections(graduationRecordId,correctionType,reason,previousValue,correctedValue,authorizedBy) VALUES(?,?,?,?,?,?)`,[id,field,data.reason,String(old[field]??''),String(data.changes[field]??''),actor.sub]);}});
  const next=await get('SELECT * FROM graduation_records WHERE id=?',[id]);await logAudit(actor,'graduation-correct','graduation_records',Number(id),{reason:data.reason},old,next);return getGraduate(id);
}

async function revokeRecord(id, reason, actor){if(!String(reason||'').trim())throw fail(400,'A revocation reason is required.');const old=await get('SELECT * FROM graduation_records WHERE id=?',[id]);if(!old)throw fail(404,'Graduate record not found.');if(!RECORD_STATUSES.has(old.recordStatus||'active'))throw fail(409,'Invalid record status.');await run(`UPDATE graduation_records SET recordStatus='revoked',status='Revoked',updatedAt=CURRENT_TIMESTAMP WHERE id=?`,[id]);await run(`INSERT INTO graduation_corrections(graduationRecordId,correctionType,reason,previousValue,correctedValue,authorizedBy) VALUES(?,'revocation',?,'active','revoked',?)`,[id,reason,actor.sub]);await logAudit(actor,'graduation-revoke','graduation_records',Number(id),{reason},old,{...old,recordStatus:'revoked'});return getGraduate(id);}

async function reports(){const [byYear,byTerm,byProgram,byDepartment,byCollege,classifications,honors,issuance,blocked,notFinalized,trend]=await Promise.all([
  all(`SELECT substr(officialGraduationDate,1,4) label,COUNT(*) value,ROUND(AVG(finalGpa),2) averageGpa FROM graduation_records WHERE finalizedAt IS NOT NULL GROUP BY label ORDER BY label`),
  all(`SELECT COALESCE(t.name,'No term') label,COUNT(*) value FROM graduation_records gr LEFT JOIN terms t ON t.id=gr.graduationTermId WHERE gr.finalizedAt IS NOT NULL GROUP BY gr.graduationTermId ORDER BY value DESC`),
  all(`SELECT p.name label,COUNT(*) value,ROUND(AVG(gr.finalGpa),2) averageGpa FROM graduation_records gr LEFT JOIN programs p ON p.id=gr.programId WHERE gr.finalizedAt IS NOT NULL GROUP BY gr.programId ORDER BY value DESC`),
  all(`SELECT COALESCE(d.name,'No department') label,COUNT(*) value FROM graduation_records gr LEFT JOIN programs p ON p.id=gr.programId LEFT JOIN departments d ON d.id=p.departmentId WHERE gr.finalizedAt IS NOT NULL GROUP BY d.id ORDER BY value DESC`),
  all(`SELECT COALESCE(c.name,'No college') label,COUNT(*) value FROM graduation_records gr LEFT JOIN programs p ON p.id=gr.programId LEFT JOIN departments d ON d.id=p.departmentId LEFT JOIN colleges c ON c.id=d.collegeId WHERE gr.finalizedAt IS NOT NULL GROUP BY c.id ORDER BY value DESC`),
  all(`SELECT COALESCE(degreeClassification,'Unclassified') label,COUNT(*) value FROM graduation_records WHERE finalizedAt IS NOT NULL GROUP BY degreeClassification`),
  all(`SELECT COALESCE(honorsOrDistinction,'None') label,COUNT(*) value FROM graduation_records WHERE finalizedAt IS NOT NULL GROUP BY honorsOrDistinction`),
  all(`SELECT certificateStatus,transcriptStatus,COUNT(*) value FROM graduation_records WHERE finalizedAt IS NOT NULL GROUP BY certificateStatus,transcriptStatus`),
  all(`SELECT h.type label,COUNT(DISTINCT h.studentId) value FROM holds h JOIN graduation_applications ga ON ga.studentId=h.studentId WHERE h.active=1 AND ga.status!='finalized' GROUP BY h.type`),
  all(`SELECT ga.status label,COUNT(*) value FROM graduation_applications ga WHERE ga.status!='finalized' GROUP BY ga.status`),
  all(`SELECT substr(officialGraduationDate,1,7) label,COUNT(*) value FROM graduation_records WHERE finalizedAt IS NOT NULL GROUP BY label ORDER BY label`),
]);return{byYear,byTerm,byProgram,byDepartment,byCollege,classifications,honors,issuance,blockedByHolds:blocked,eligibleCandidatesNotFinalized:notFinalized,completionTrend:trend};}

async function reconciliationPreview(){const rows=await all(`SELECT u.id studentId,u.idNumber,u.name,sp.programId,p.name programName,sp.studentStatus,sp.graduationDate,sp.degreeAwarded,
  gr.id graduationRecordId FROM users u JOIN student_profiles sp ON sp.studentId=u.id LEFT JOIN programs p ON p.id=sp.programId LEFT JOIN graduation_records gr ON gr.studentId=u.id
  WHERE sp.studentStatus='Graduated' AND gr.id IS NULL ORDER BY u.name`);return rows.map(r=>({...r,availableAcademicData:{programId:r.programId,programName:r.programName,graduationDate:r.graduationDate,degreeAwarded:r.degreeAwarded},missingGraduationData:['studentProgramId','curriculum snapshot','approval history','final GPA snapshot','completed credits snapshot'].filter(k=>!r[k]),proposedRecord:null,conflicts:['No permanent graduation record; manual documentary review required.'],requiresManualReview:true}));}

module.exports={listPotentialCandidates,graduationAudit,createApplication,updateApplicationStatus,finalizeGraduation,listRegistry,getGraduate,updateIssuance,correctRecord,revokeRecord,reports,reconciliationPreview,fail};
