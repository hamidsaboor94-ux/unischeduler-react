/** Curriculum is additive to course prerequisites. It determines degree-plan membership and
 * recommended timing; eligibility.js remains the sole prerequisite engine. */
const { get, all, run, transaction, logAudit } = require('./db');
const { computeAcademicSummary } = require('./academicSummary');
const { getGradingScale } = require('./gradingScale');

const STATUSES = ['draft', 'active', 'archived'];
const statusSql = `LOWER(c.status)`;
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const normalized = (row) => row && ({ ...row,
  name: row.name ?? row.curriculumName,
  catalogYear: row.catalogYear ?? row.academicYear,
  totalRequiredCredits: row.totalRequiredCredits ?? row.totalCredits,
  status: String(row.status || 'draft').toLowerCase(),
});

async function listCurricula(programId) {
  const rows = await all(`SELECT c.*, p.name programName FROM curriculum c JOIN programs p ON p.id=c.programId
    ${programId ? 'WHERE c.programId=?' : ''} ORDER BY p.name, COALESCE(c.catalogYear,c.academicYear) DESC, c.id DESC`, programId ? [programId] : []);
  return rows.map(normalized);
}

async function getCurriculumStructure(id) {
  const raw = await get(`SELECT c.*, p.name programName FROM curriculum c JOIN programs p ON p.id=c.programId WHERE c.id=?`, [id]);
  if (!raw) return null;
  const curriculum = normalized(raw);
  const semesters = await all(`SELECT * FROM curriculum_semester WHERE curriculumId=? ORDER BY semesterNumber`, [id]);
  const electiveGroups = await all(`SELECT *, COALESCE(minimumCourses,requiredCount,0) minimumCourses,
    COALESCE(minimumCredits,requiredCredits,0) minimumCredits FROM elective_group WHERE curriculumId=? ORDER BY name`, [id]);
  const semesterIds = semesters.map(s => s.id);
  const rows = semesterIds.length ? await all(`SELECT cc.*, co.code,co.name,co.credits,
    COALESCE(cc.courseType,CASE WHEN cc.required=1 THEN 'required' ELSE 'elective' END) courseType,
    COALESCE(cc.minimumPassingGrade,cc.minimumGrade) minimumPassingGrade,
    COALESCE(cc.recommendedSequence,cc.sequence,0) recommendedSequence
    FROM curriculum_course cc JOIN courses co ON co.id=cc.courseId
    WHERE cc.curriculumSemesterId IN (${semesterIds.map(()=>'?').join(',')})
    ORDER BY recommendedSequence,co.code`, semesterIds) : [];
  const bySemester = new Map(semesters.map(s => [s.id, { ...s, totalCredits: 0, courses: [] }]));
  for (const row of rows) { const bucket=bySemester.get(row.curriculumSemesterId); bucket.courses.push(row); bucket.totalCredits += Number(row.credits)||0; }
  return { curriculum, electiveGroups, semesters: semesters.map(s => bySemester.get(s.id)),
    calculatedCredits: rows.reduce((n,r)=>n+(Number(r.credits)||0),0) };
}

async function assertDraft(id) {
  const c = await get('SELECT * FROM curriculum WHERE id=?', [id]);
  if (!c) throw fail(404, 'Curriculum not found.', 'CURRICULUM_NOT_FOUND');
  if (String(c.status).toLowerCase() !== 'draft') throw fail(409, 'Only a draft curriculum can be structurally edited.', 'CURRICULUM_IMMUTABLE');
  return c;
}

async function validateCurriculum(id) {
  const structure = await getCurriculumStructure(id);
  if (!structure) throw fail(404, 'Curriculum not found.');
  const errors=[];
  if (!structure.semesters.length) errors.push('At least one curriculum semester is required.');
  if (!structure.semesters.some(s=>s.courses.length)) errors.push('At least one curriculum course is required.');
  for (const s of structure.semesters) {
    if (s.minimumCredits != null && s.maximumCredits != null && s.minimumCredits > s.maximumCredits) errors.push(`${s.name || `Semester ${s.semesterNumber}`}: minimum credits exceed maximum credits.`);
    for (const c of s.courses) {
      if (c.courseType === 'required' && c.electiveGroupId) errors.push(`${c.code}: a required course cannot use an elective group.`);
      if (c.courseType === 'elective' && c.electiveGroupId && !structure.electiveGroups.some(g=>g.id===c.electiveGroupId)) errors.push(`${c.code}: elective group is outside this curriculum.`);
    }
  }
  const required = structure.curriculum.totalRequiredCredits;
  if (required != null && structure.calculatedCredits < required) errors.push(`Planned credits (${structure.calculatedCredits}) are below required credits (${required}).`);
  return { valid: !errors.length, errors, ...structure };
}

async function createCurriculum(data, actor) {
  if (!data.programId || !String(data.name||'').trim()) throw fail(400, 'programId and name are required.');
  const result=await run(`INSERT INTO curriculum(programId,curriculumName,academicYear,catalogYear,effectiveFrom,effectiveTo,totalCredits,totalRequiredCredits,status)
    VALUES(?,?,?,?,?,?,?,?, 'draft')`, [data.programId,data.name.trim(),data.catalogYear||null,data.catalogYear||null,data.effectiveFrom||null,data.effectiveTo||null,data.totalRequiredCredits??null,data.totalRequiredCredits??null]);
  const row=normalized(await get('SELECT * FROM curriculum WHERE id=?',[result.id]));
  await logAudit(actor,'curriculum-create','curriculum',row.id,null,null,row); return row;
}

async function updateCurriculum(id,data,actor) {
  const old=await assertDraft(id);
  await run(`UPDATE curriculum SET curriculumName=?, academicYear=?,catalogYear=?,effectiveFrom=?,effectiveTo=?,totalCredits=?,totalRequiredCredits=?,updatedAt=CURRENT_TIMESTAMP WHERE id=?`,
    [data.name??old.curriculumName,data.catalogYear??old.catalogYear??old.academicYear,data.catalogYear??old.catalogYear??old.academicYear,data.effectiveFrom??old.effectiveFrom,data.effectiveTo===undefined?old.effectiveTo:data.effectiveTo,data.totalRequiredCredits??old.totalRequiredCredits??old.totalCredits,data.totalRequiredCredits??old.totalRequiredCredits??old.totalCredits,id]);
  const row=normalized(await get('SELECT * FROM curriculum WHERE id=?',[id])); await logAudit(actor,'curriculum-update','curriculum',id,null,old,row); return row;
}

async function activateCurriculum(id,actor) {
  const check=await validateCurriculum(id); if(!check.valid) throw fail(422,check.errors.join(' '),'CURRICULUM_INCOMPLETE');
  const c=await assertDraft(id);
  const overlap=await get(`SELECT id FROM curriculum c WHERE programId=? AND id<>? AND ${statusSql}='active'
    AND COALESCE(effectiveTo,'9999-12-31')>=COALESCE(?,'0000-01-01') AND COALESCE(?,'9999-12-31')>=COALESCE(effectiveFrom,'0000-01-01')`,[c.programId,id,c.effectiveFrom,c.effectiveTo]);
  if(overlap) throw fail(409,'Another active curriculum overlaps this effective period.','CURRICULUM_PERIOD_OVERLAP');
  await run(`UPDATE curriculum SET status='active',updatedAt=CURRENT_TIMESTAMP WHERE id=?`,[id]);
  await logAudit(actor,'curriculum-activate','curriculum',id,null,{status:c.status},{status:'active'}); return normalized(await get('SELECT * FROM curriculum WHERE id=?',[id]));
}

async function archiveCurriculum(id,actor) { const old=await get('SELECT * FROM curriculum WHERE id=?',[id]); if(!old) throw fail(404,'Curriculum not found.');
  await run(`UPDATE curriculum SET status='archived',updatedAt=CURRENT_TIMESTAMP WHERE id=?`,[id]); await logAudit(actor,'curriculum-archive','curriculum',id,null,old,{...old,status:'archived'}); }

async function cloneCurriculum(id,data,actor) {
  const source=await getCurriculumStructure(id); if(!source) throw fail(404,'Curriculum not found.');
  return transaction(async()=>{ const copy=await createCurriculum({programId:source.curriculum.programId,name:data.name||`${source.curriculum.name} Copy`,catalogYear:data.catalogYear,effectiveFrom:data.effectiveFrom,effectiveTo:data.effectiveTo,totalRequiredCredits:source.curriculum.totalRequiredCredits},actor);
    const groupMap=new Map(); for(const g of source.electiveGroups){const x=await run(`INSERT INTO elective_group(curriculumId,name,requiredCount,requiredCredits,minimumCourses,minimumCredits,maximumCourses,description,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,[copy.id,g.name,g.minimumCourses,g.minimumCredits,g.minimumCourses,g.minimumCredits,g.maximumCourses,g.description]);groupMap.set(g.id,x.id);}
    for(const s of source.semesters){const x=await run(`INSERT INTO curriculum_semester(curriculumId,semesterNumber,name,minimumCredits,maximumCredits,createdAt,updatedAt) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,[copy.id,s.semesterNumber,s.name,s.minimumCredits,s.maximumCredits]);for(const c of s.courses) await run(`INSERT INTO curriculum_course(curriculumSemesterId,courseId,required,electiveGroupId,minimumGrade,sequence,notes,courseType,minimumPassingGrade,recommendedSequence,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,[x.id,c.courseId,c.courseType==='required'?1:0,c.electiveGroupId?groupMap.get(c.electiveGroupId):null,c.minimumPassingGrade,c.recommendedSequence,c.notes,c.courseType,c.minimumPassingGrade,c.recommendedSequence]);} return getCurriculumStructure(copy.id); });
}

async function assignStudent(studentId,curriculumId,{notes,reason}={},actor){ const student=await get(`SELECT u.id,sp.programId FROM users u LEFT JOIN student_profiles sp ON sp.studentId=u.id WHERE u.id=? AND u.role='student'`,[studentId]); if(!student) throw fail(404,'Student not found.');
  const c=await get('SELECT * FROM curriculum WHERE id=?',[curriculumId]); if(!c) throw fail(404,'Curriculum not found.'); if(Number(student.programId)!==Number(c.programId)) throw fail(409,"Curriculum does not belong to the student's program.");
  const current=await get('SELECT * FROM student_curriculum WHERE studentId=?',[studentId]); if(current&&Number(current.curriculumId)===Number(curriculumId)) throw fail(409,'Student already has this active curriculum.'); if(current&&!String(reason||'').trim()) throw fail(400,'A reason is required to change a curriculum assignment.');
  return transaction(async()=>{if(current){await run(`UPDATE student_curriculum_history SET status='changed',endedAt=CURRENT_TIMESTAMP,endedBy=? WHERE studentId=? AND status='active'`,[actor.sub,studentId]);await run(`UPDATE student_curriculum SET curriculumId=?,assignedAt=CURRENT_TIMESTAMP,assignedBy=?,status='active',notes=? WHERE studentId=?`,[curriculumId,actor.sub,notes||null,studentId]);}else await run(`INSERT INTO student_curriculum(studentId,curriculumId,assignedBy,status,notes) VALUES(?,?,?,'active',?)`,[studentId,curriculumId,actor.sub,notes||null]);
    const h=await run(`INSERT INTO student_curriculum_history(studentId,curriculumId,assignedBy,status,notes) VALUES(?,?,?,'active',?)`,[studentId,curriculumId,actor.sub,notes||null]); await logAudit(actor,current?'curriculum-reassign-student':'curriculum-assign-student','student_curriculum',h.id,{reason:reason||null},current,{studentId,curriculumId,notes}); return getStudentAssignment(studentId);}); }

async function getStudentAssignment(studentId){const current=await get(`SELECT sc.*,c.curriculumName name,COALESCE(c.catalogYear,c.academicYear) catalogYear,c.programId FROM student_curriculum sc JOIN curriculum c ON c.id=sc.curriculumId WHERE sc.studentId=? AND LOWER(sc.status)='active'`,[studentId]); const history=await all(`SELECT h.*,c.curriculumName name,COALESCE(c.catalogYear,c.academicYear) catalogYear FROM student_curriculum_history h JOIN curriculum c ON c.id=h.curriculumId WHERE h.studentId=? ORDER BY h.assignedAt DESC,h.id DESC`,[studentId]);return {current,history};}

async function curriculumRegistrationCheck(studentId,courseId,{allowSemesterOverride=false}={}){const assignment=(await getStudentAssignment(studentId)).current;if(!assignment)return {eligible:false,code:'NO_CURRICULUM',reason:'Student has no assigned curriculum.'};
  const course=await get('SELECT id,name,code FROM courses WHERE id=?',[courseId]); if(!course) return {eligible:false,code:'COURSE_NOT_FOUND',reason:'Course not found.'};
  const item=await get(`SELECT cc.*,cs.semesterNumber FROM curriculum_course cc JOIN curriculum_semester cs ON cs.id=cc.curriculumSemesterId JOIN courses authored ON authored.id=cc.courseId WHERE cs.curriculumId=? AND LOWER(TRIM(authored.name))=LOWER(TRIM(?))`,[assignment.curriculumId,course.name]); if(!item)return {eligible:false,code:'OUTSIDE_CURRICULUM',reason:"Course is not part of the student's assigned curriculum.",curriculumId:assignment.curriculumId};
  const profile=await get('SELECT programSemester FROM student_profiles WHERE studentId=?',[studentId]); const recommended=Number(item.semesterNumber); const current=Number(profile?.programSemester||1); if(recommended!==current&&!allowSemesterOverride)return {eligible:false,code:'SEMESTER_RECOMMENDATION',reason:`Course is recommended for Semester ${recommended}.`,recommendedSemester:recommended,curriculumId:assignment.curriculumId,item};
  if(item.electiveGroupId){const group=await get('SELECT * FROM elective_group WHERE id=?',[item.electiveGroupId]);if(group?.maximumCourses!=null){const done=await get(`SELECT COUNT(DISTINCT LOWER(TRIM(c.name))) n FROM enrollments e JOIN courses c ON c.id=e.courseId JOIN curriculum_course cc ON cc.electiveGroupId=? JOIN courses authored ON authored.id=cc.courseId WHERE e.studentId=? AND e.status='enrolled' AND e.grade IS NOT NULL AND LOWER(TRIM(c.name))=LOWER(TRIM(authored.name))`,[item.electiveGroupId,studentId]);if(done.n>=group.maximumCourses)return {eligible:false,code:'ELECTIVE_GROUP_LIMIT',reason:'Required elective-group limit already satisfied.',curriculumId:assignment.curriculumId,item};}}
  return {eligible:true,curriculumId:assignment.curriculumId,item,recommendedSemester:recommended};}

async function studentAudit(studentId) {
  const assignment = (await getStudentAssignment(studentId)).current;
  if (!assignment) return { eligible:false, errors:['Student has no assigned curriculum.'], code:'NO_CURRICULUM' };
  const structure = await getCurriculumStructure(assignment.curriculumId);
  const scale = await getGradingScale();
  const points = new Map(scale.map(x => [x.label, Number(x.point)]));
  const completed = await all(
    `SELECT c.id,c.name,c.code,c.credits,e.grade FROM enrollments e JOIN courses c ON c.id=e.courseId
     WHERE e.studentId=? AND e.status='enrolled' AND e.grade IS NOT NULL`, [studentId]
  );
  const passing = completed.filter(x => (points.get(x.grade) || 0) > 0);
  const byName = new Map(passing.map(x => [x.name.trim().toLowerCase(), x]));
  const allPlanned = structure.semesters.flatMap(s => s.courses);
  const required = allPlanned.filter(c => c.courseType === 'required');
  const meetsGrade = c => {
    const row = byName.get(c.name.trim().toLowerCase());
    return row && (!c.minimumPassingGrade || (points.get(row.grade) || 0) >= (points.get(c.minimumPassingGrade) || 0));
  };
  const missingRequired = required.filter(c => !meetsGrade(c));
  const groups = structure.electiveGroups.map(g => {
    const choices = allPlanned.filter(c => c.electiveGroupId === g.id);
    const done = choices.filter(meetsGrade);
    const credits = done.reduce((n,c) => n + (Number(c.credits) || 0), 0);
    return { ...g, completedCourses:done, completedCredits:credits,
      satisfied:done.length >= Number(g.minimumCourses || 0) && credits >= Number(g.minimumCredits || 0) };
  });
  const summary = await computeAcademicSummary(studentId);
  const holds = await all('SELECT * FROM holds WHERE studentId=? AND active=1', [studentId]);
  const missingGrades = await all(
    `SELECT c.code,c.name FROM enrollments e JOIN courses c ON c.id=e.courseId
     WHERE e.studentId=? AND e.status='enrolled' AND e.grade IS NULL`, [studentId]
  );
  // Lazy import avoids the eligibility -> curriculum module cycle while reusing the prerequisite
  // engine as the one source of truth once both modules have finished loading.
  const { evaluatePrerequisites } = require('./eligibility');
  const missingPrerequisites = [];
  for (const course of passing) {
    // eslint-disable-next-line no-await-in-loop
    const evaluation = await evaluatePrerequisites(studentId, course.id);
    for (const requirement of evaluation.requirements.filter(r => !r.satisfied)) {
      missingPrerequisites.push({ targetName:course.name, targetCode:course.code, group:requirement.group,
        rule:requirement.rule, options:requirement.options });
    }
  }
  const remaining = Math.max(0, Number(structure.curriculum.totalRequiredCredits || 0) - summary.completedCredits);
  return { studentId, curriculum:structure.curriculum, completedRequired:required.filter(meetsGrade), missingRequired,
    electiveGroups:groups, completedCredits:summary.completedCredits, remainingCredits:remaining, gpa:summary.gpa,
    gpaStatus:{gpa:summary.gpa,minimum:null,satisfied:true,policyConfigured:false}, holds, missingGrades, missingPrerequisites,
    eligible:!missingRequired.length && groups.every(g=>g.satisfied) && remaining===0 && !holds.length && !missingGrades.length && !missingPrerequisites.length };
}

module.exports={STATUSES,listCurricula,getCurriculumStructure,validateCurriculum,createCurriculum,updateCurriculum,activateCurriculum,archiveCurriculum,cloneCurriculum,assignStudent,getStudentAssignment,curriculumRegistrationCheck,studentAudit,assertDraft,fail};
