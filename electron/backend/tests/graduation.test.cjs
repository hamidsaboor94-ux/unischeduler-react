process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const service = require('../graduationService');
const approvals = require('../approvalEngine');

let actor;
let studentId;
let application;

test('graduation workflow and permanent registry', async t => {
  await db.init();
  const admin = await db.run(`INSERT INTO users(name,email,role) VALUES('Registrar Test','registrar@test.invalid','admin')`);
  actor = { sub: admin.id, role: 'admin' };
  const college = await db.run(`INSERT INTO colleges(name) VALUES('Science')`);
  const department = await db.run(`INSERT INTO departments(name,collegeId) VALUES('Computing',?)`, [college.id]);
  const program = await db.run(`INSERT INTO programs(name,departmentId,degreeLevel,totalCredits) VALUES('Computer Science',?,'BSc',3)`, [department.id]);
  const term = await db.run(`INSERT INTO terms(name,startDate,endDate,isActive) VALUES('Spring 2026','2026-01-01','2026-06-01',1)`);
  const course = await db.run(`INSERT INTO courses(code,name,credits,departmentId,termId) VALUES('CS101','Foundations',3,?,?)`, [department.id, term.id]);
  const student = await db.run(`INSERT INTO users(name,email,role,idNumber) VALUES('Eligible Student','student@test.invalid','student','STU-TEST-001')`);
  studentId = student.id;
  await db.run(`INSERT INTO student_profiles(studentId,departmentId,programId,programSemester,studentStatus,enrollmentDate,semesterStatus) VALUES(?,?,?,1,'Active','2022-09-01','Graduation Eligible')`, [studentId, department.id, program.id]);
  const curriculum = await db.run(`INSERT INTO curriculum(programId,curriculumName,status,totalCredits,totalRequiredCredits,catalogYear) VALUES(?,'BSc CS 2022','active',3,3,'2022')`, [program.id]);
  const semester = await db.run(`INSERT INTO curriculum_semester(curriculumId,semesterNumber,name,minimumCredits) VALUES(?,1,'Semester 1',3)`, [curriculum.id]);
  await db.run(`INSERT INTO curriculum_course(curriculumSemesterId,courseId,required,courseType) VALUES(?,?,1,'required')`, [semester.id, course.id]);
  await db.run(`INSERT INTO student_curriculum(studentId,curriculumId,status,assignedBy) VALUES(?,?,'active',?)`, [studentId, curriculum.id, admin.id]);
  await db.run(`INSERT INTO settings(key,value) VALUES('graduationMinimumGpa','2.0')`);

  await t.test('candidate audit rejects missing required courses and credits', async () => {
    const audit = await service.graduationAudit(studentId);
    assert.equal(audit.eligible, false);
    assert.ok(audit.reasons.some(r => r.code === 'REQUIRED_COURSE_MISSING'));
    assert.ok(audit.reasons.some(r => r.code === 'INSUFFICIENT_CREDITS'));
  });

  await db.run(`INSERT INTO enrollments(studentId,courseId,status,grade) VALUES(?,?,'enrolled','F')`, [studentId, course.id]);
  await t.test('candidate audit rejects failed required course and low GPA', async () => {
    const audit = await service.graduationAudit(studentId);
    assert.equal(audit.eligible, false);
    assert.ok(audit.reasons.some(r => r.code === 'REQUIRED_COURSE_MISSING'));
    assert.ok(audit.reasons.some(r => r.code === 'LOW_GPA'));
  });

  await db.run(`UPDATE enrollments SET grade='A' WHERE studentId=? AND courseId=?`, [studentId, course.id]);
  const hold = await db.run(`INSERT INTO holds(studentId,type,active,reason,placedBy) VALUES(?,'library',1,'Unreturned book',?)`, [studentId, admin.id]);
  await t.test('candidate audit rejects active holds with a separate reason', async () => {
    const audit = await service.graduationAudit(studentId);
    assert.equal(audit.eligible, false);
    assert.ok(audit.reasons.some(r => r.code === 'ACTIVE_HOLD' && r.details.type === 'library'));
  });
  await db.run(`UPDATE holds SET active=0 WHERE id=?`, [hold.id]);

  await t.test('candidate audit rejects incomplete elective requirements', async () => {
    const electiveCourse = await db.run(`INSERT INTO courses(code,name,credits,departmentId,termId) VALUES('CS201','Computing Elective',3,?,?)`, [department.id, term.id]);
    const group = await db.run(`INSERT INTO elective_group(curriculumId,name,minimumCourses,minimumCredits) VALUES(?,'Computing elective',1,3)`, [curriculum.id]);
    await db.run(`INSERT INTO curriculum_course(curriculumSemesterId,courseId,required,courseType,electiveGroupId) VALUES(?,?,0,'elective',?)`, [semester.id, electiveCourse.id, group.id]);
    const blocked = await service.graduationAudit(studentId);
    assert.ok(blocked.reasons.some(r => r.code === 'ELECTIVE_REQUIREMENT_MISSING'));
    await db.run(`INSERT INTO enrollments(studentId,courseId,status,grade) VALUES(?,?,'enrolled','A')`, [studentId, electiveCourse.id]);
  });

  await t.test('candidate audit rejects missing grades and active registrations', async () => {
    const pendingCourse = await db.run(`INSERT INTO courses(code,name,credits,departmentId,termId) VALUES('CS299','Pending Result',1,?,?)`, [department.id, term.id]);
    const enrollment = await db.run(`INSERT INTO enrollments(studentId,courseId,status,grade) VALUES(?,?,'enrolled',NULL)`, [studentId, pendingCourse.id]);
    const blocked = await service.graduationAudit(studentId);
    assert.ok(blocked.reasons.some(r => r.code === 'MISSING_GRADE'));
    assert.ok(blocked.reasons.some(r => r.code === 'ACTIVE_REGISTRATION'));
    await db.run(`UPDATE enrollments SET status='dropped',deletedAt=CURRENT_TIMESTAMP WHERE id=?`, [enrollment.id]);
  });

  await t.test('eligible candidate creates one preserved application', async () => {
    application = await service.createApplication(studentId, { expectedGraduationTermId: term.id }, actor);
    assert.equal(application.status, 'under_review');
    const audit = await service.graduationAudit(studentId, { applicationId: application.id });
    assert.equal(audit.result, 'eligible');
    await assert.rejects(() => service.createApplication(studentId, { expectedGraduationTermId: term.id }, actor));
  });

  await t.test('configured thesis or practicum requirements must be verified', async () => {
    await db.run(`INSERT INTO graduation_requirements(curriculumId,requirementType,label,required) VALUES(?,'thesis','Thesis defense',1)`, [curriculum.id]);
    let audit = await service.graduationAudit(studentId, { applicationId: application.id });
    assert.ok(audit.reasons.some(r => r.code === 'SPECIAL_REQUIREMENT'));
    await db.run(`INSERT INTO graduation_requirement_results(graduationApplicationId,requirementType,status) VALUES(?,'thesis','completed')`, [application.id]);
    audit = await service.graduationAudit(studentId, { applicationId: application.id });
    assert.equal(audit.eligible, true);
  });

  await t.test('finalization is rejected before all approval stages', async () => {
    await assert.rejects(() => service.finalizeGraduation(application.id, {}, actor), err => err.code === 'APPROVALS_INCOMPLETE');
  });

  await t.test('all configured stages are recorded and graduation finalizes atomically', async () => {
    let requestId = application.approvalRequest.id;
    const viewer = await db.run(`INSERT INTO users(name,email,role) VALUES('Unauthorized Reviewer','viewer@test.invalid','viewer')`);
    await assert.rejects(() => approvals.decide(requestId, { sub: viewer.id, role: 'viewer' }, 'approve', 'not allowed'), err => err.status === 403);
    for (let i = 0; i < 4; i += 1) await approvals.decide(requestId, actor, 'approve', `stage ${i + 1} approved`);
    const lateHold = await db.run(`INSERT INTO holds(studentId,type,active,reason,placedBy) VALUES(?,'administrative',1,'Late clearance issue',?)`, [studentId, actor.sub]);
    await assert.rejects(() => service.finalizeGraduation(application.id, {}, actor), err => err.code === 'GRADUATION_INELIGIBLE');
    assert.equal((await db.get('SELECT COUNT(*) n FROM graduation_records WHERE studentId=?', [studentId])).n, 0);
    assert.equal((await db.get('SELECT status FROM graduation_applications WHERE id=?', [application.id])).status, 'approved');
    await db.run('UPDATE holds SET active=0 WHERE id=?', [lateHold.id]);
    const result = await service.finalizeGraduation(application.id, { officialGraduationDate: '2026-06-15' }, actor);
    assert.equal(result.alreadyFinalized, false);
    assert.match(result.record.graduateNumber, /^GR-2026-/);
    const attempt = await db.get('SELECT status FROM student_programs WHERE id=?', [result.record.studentProgramId]);
    const profile = await db.get('SELECT studentStatus FROM student_profiles WHERE studentId=?', [studentId]);
    assert.equal(attempt.status, 'graduated');
    assert.equal(profile.studentStatus, 'Graduated');
    assert.equal((await db.get('SELECT COUNT(*) n FROM graduation_audits WHERE graduationRecordId=?', [result.record.id])).n, 1);
  });

  await t.test('re-running finalization is idempotent and registry lists finalized records only', async () => {
    const again = await service.finalizeGraduation(application.id, {}, actor);
    assert.equal(again.alreadyFinalized, true);
    assert.equal((await db.get('SELECT COUNT(*) n FROM graduation_records WHERE studentId=?', [studentId])).n, 1);
    const registry = await service.listRegistry({ year: 2026, programId: program.id });
    assert.equal(registry.total, 1);
    assert.equal(registry.items[0].studentId, studentId);
  });

  await t.test('certificate and transcript statuses are preserved as issuance events', async () => {
    const record = await db.get('SELECT id FROM graduation_records WHERE studentId=?', [studentId]);
    await service.updateIssuance(record.id, 'certificate', { status: 'issued' }, actor);
    await service.updateIssuance(record.id, 'transcript', { status: 'ready' }, actor);
    const updated = await db.get('SELECT certificateStatus,transcriptStatus FROM graduation_records WHERE id=?', [record.id]);
    assert.equal(updated.certificateStatus, 'issued');
    assert.equal(updated.transcriptStatus, 'ready');
    assert.equal((await db.get('SELECT COUNT(*) n FROM graduation_issuance_events WHERE graduationRecordId=?', [record.id])).n, 2);
  });

  await t.test('canonical records from the legacy graduation workflow remain visible after migration', async () => {
    const legacyStudent = await db.run(`INSERT INTO users(name,email,role,idNumber) VALUES('Legacy Graduate','legacy-graduate@test.invalid','student','STU-LEGACY-001')`);
    await db.run(`INSERT INTO student_profiles(studentId,programId,studentStatus,semesterStatus,graduationDate,degreeAwarded)
      VALUES(?,?,'Graduated','Graduation Eligible','2025-06-30','BSc in Computer Science')`, [legacyStudent.id, program.id]);
    const legacyRecord = await db.run(`INSERT INTO graduation_records(studentId,degreeAwarded,graduationDate,conferredBy,certificateNumber,status)
      VALUES(?,'BSc in Computer Science','2025-06-30',?,'CERT-2025-LEGACY','Active')`, [legacyStudent.id, admin.id]);

    await db.init();

    const migrated = await db.get(`SELECT graduateNumber,programId,officialGraduationDate,certificateStatus,finalizedAt,notes
      FROM graduation_records WHERE id=?`, [legacyRecord.id]);
    assert.match(migrated.graduateNumber, /^GR-2025-/);
    assert.equal(migrated.programId, program.id);
    assert.equal(migrated.officialGraduationDate, '2025-06-30');
    assert.equal(migrated.certificateStatus, 'generated');
    assert.ok(migrated.finalizedAt);
    assert.match(migrated.notes, /legacy graduation workflow/);
    assert.equal((await db.get('SELECT semesterStatus FROM student_profiles WHERE studentId=?', [legacyStudent.id])).semesterStatus, 'Completed');
    const registry = await service.listRegistry({ search: 'STU-LEGACY-001' });
    assert.equal(registry.total, 1);
    assert.equal(registry.items[0].studentId, legacyStudent.id);
  });
});
