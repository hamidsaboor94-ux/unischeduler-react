process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'single-student-lifecycle-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { computeAcademicSummary } = require('../academicSummary');

function approximately(actual, expected, epsilon = 0.01) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= epsilon, `${actual} was not within ${epsilon} of ${expected}`);
}

test('single student completes the real academic lifecycle and formal graduation workflow', async t => {
  await db.init();

  const users = {};
  for (const [key, name, role, departmentScoped] of [
    ['admin', 'Lifecycle Administrator', 'admin', false],
    ['faculty', 'Lifecycle Faculty', 'faculty', false],
    ['deptHead', 'Lifecycle Department Head', 'dept_head', true],
    ['registrar', 'Lifecycle Registrar', 'registrar', false],
    ['bursar', 'Lifecycle Bursar', 'bursar', false],
    ['records', 'Lifecycle Records Officer', 'records_officer', false],
    ['viewer', 'Lifecycle Unauthorized Viewer', 'viewer', false],
    ['student', 'Lifecycle Test Student', 'student', false],
  ]) {
    const inserted = await db.run(
      'INSERT INTO users(name,email,role,idNumber) VALUES(?,?,?,?)',
      [name, `${key}@lifecycle.test.invalid`, role, role === 'student' ? 'LIFECYCLE-STUDENT-001' : null]
    );
    users[key] = { id: inserted.id, name, role, departmentScoped };
  }

  const college = await db.run("INSERT INTO colleges(name) VALUES('Lifecycle College')");
  const department = await db.run("INSERT INTO departments(name,collegeId) VALUES('Lifecycle Computing',?)", [college.id]);
  await db.run('UPDATE users SET departmentId=? WHERE id=?', [department.id, users.deptHead.id]);
  const program = await db.run(
    "INSERT INTO programs(name,departmentId,degreeLevel,totalCredits) VALUES('Lifecycle BSc',?,'BSc',36)",
    [department.id]
  );
  const teacher = await db.run(
    "INSERT INTO teachers(name,departmentId,userId) VALUES('Lifecycle Faculty',?,?)",
    [department.id, users.faculty.id]
  );
  const room = await db.run("INSERT INTO rooms(name,type,capacity) VALUES('LIFECYCLE-R1','Classroom',100)");

  const registrationOpensAt = '2026-01-01T00:00:00.000Z';
  const registrationClosesAt = '2027-12-31T23:59:59.999Z';
  const term1 = await db.run(
    `INSERT INTO terms(name,startDate,endDate,isActive,creditLimit,registrationOpensAt,registrationClosesAt)
     VALUES('Lifecycle Semester 1','2026-01-01','2026-06-30',1,21,?,?)`,
    [registrationOpensAt, registrationClosesAt]
  );
  const term2 = await db.run(
    `INSERT INTO terms(name,startDate,endDate,isActive,creditLimit,registrationOpensAt,registrationClosesAt)
     VALUES('Lifecycle Semester 2','2026-07-01','2026-12-31',0,21,?,?)`,
    [registrationOpensAt, registrationClosesAt]
  );

  await db.run(
    `INSERT INTO student_profiles(studentId,departmentId,programId,programSemester,studentStatus,enrollmentStatus,
       enrollmentDate,semesterStatus) VALUES(?,?,?,1,'Active','Regular','2026-01-01','In Progress')`,
    [users.student.id, department.id, program.id]
  );
  const curriculum = await db.run(
    `INSERT INTO curriculum(programId,curriculumName,status,totalCredits,totalRequiredCredits,catalogYear,academicYear)
     VALUES(?,'LIFECYCLE TEST Curriculum 2026','active',36,36,'2026','2026')`,
    [program.id]
  );
  const curriculumSemesters = [];
  for (const semesterNumber of [1, 2]) {
    curriculumSemesters.push(await db.run(
      `INSERT INTO curriculum_semester(curriculumId,semesterNumber,name,minimumCredits,maximumCredits)
       VALUES(?,?,?,18,21)`,
      [curriculum.id, semesterNumber, `Semester ${semesterNumber}`]
    ));
  }
  await db.run(
    `INSERT INTO student_curriculum(studentId,curriculumId,status,assignedBy,notes)
     VALUES(?,?,'active',?,'LIFECYCLE TEST DATA')`,
    [users.student.id, curriculum.id, users.admin.id]
  );
  await db.run(
    `INSERT INTO student_curriculum_history(studentId,curriculumId,status,assignedBy,notes)
     VALUES(?,?,'active',?,'LIFECYCLE TEST DATA')`,
    [users.student.id, curriculum.id, users.admin.id]
  );
  await db.run("INSERT INTO settings(key,value) VALUES('graduationMinimumGpa','2.0')");
  await db.run("INSERT INTO settings(key,value) VALUES('attendanceWarningThreshold','75')");
  await db.run("INSERT INTO settings(key,value) VALUES('attendanceExamThreshold','60')");
  await db.run("INSERT INTO settings(key,value) VALUES('maxFailedCoursesForProgression','1')");

  const coursesBySemester = [[], []];
  const slots = new Map();
  const exams = new Map();
  for (const semesterNumber of [1, 2]) {
    const termId = semesterNumber === 1 ? term1.id : term2.id;
    for (let index = 1; index <= 6; index += 1) {
      const code = `LCT${semesterNumber}${String(index).padStart(2, '0')}`;
      const course = await db.run(
        `INSERT INTO courses(code,name,departmentId,credits,teacherId,roomId,maxStudents,termId,programId)
         VALUES(?,?,?,3,?,?,50,?,?)`,
        [code, `Lifecycle Semester ${semesterNumber} Course ${index}`, department.id, teacher.id, room.id, termId, program.id]
      );
      const row = { id: course.id, code, credits: 3, semesterNumber };
      coursesBySemester[semesterNumber - 1].push(row);
      await db.run(
        `INSERT INTO curriculum_course(curriculumSemesterId,courseId,required,courseType,minimumPassingGrade,recommendedSequence)
         VALUES(?,?,1,'required','D',?)`,
        [curriculumSemesters[semesterNumber - 1].id, course.id, index]
      );
      const slot = await db.run(
        `INSERT INTO timetable_slots(courseId,day,time,durationMinutes,roomId,termId,programSemester)
         VALUES(?,?,?,60,?,?,?)`,
        [course.id, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index - 1], `${String(7 + index).padStart(2, '0')}:00`, room.id, termId, semesterNumber]
      );
      slots.set(course.id, slot.id);
      const exam = await db.run(
        `INSERT INTO exams(courseId,date,time,durationMinutes,roomId,invigilatorId,termId,type)
         VALUES(?,?,?,120,?,?,?,'final')`,
        [course.id, semesterNumber === 1 ? '2026-06-20' : '2026-12-20', `${String(8 + index).padStart(2, '0')}:00`, room.id, teacher.id, termId]
      );
      exams.set(course.id, exam.id);
    }
  }

  const [sem1Course1, sem1Course2, sem1Course3, sem1Course4] = coursesBySemester[0];
  await db.run(
    `INSERT INTO course_prerequisites(courseId,prerequisiteCourseId,type) VALUES(?,?,'prerequisite')`,
    [sem1Course2.id, sem1Course1.id]
  );
  await db.run(
    `INSERT INTO course_prerequisites(courseId,prerequisiteCourseId,type) VALUES(?,?,'corequisite')`,
    [sem1Course3.id, sem1Course4.id]
  );

  async function addOptionalCourse({ code, name, credits, termId, semesterIndex, day, time }) {
    const inserted = await db.run(
      `INSERT INTO courses(code,name,departmentId,credits,teacherId,roomId,maxStudents,termId,programId)
       VALUES(?,?,?,?,?,?,50,?,?)`,
      [code, name, department.id, credits, teacher.id, room.id, termId, program.id]
    );
    await db.run(
      `INSERT INTO curriculum_course(curriculumSemesterId,courseId,required,courseType,recommendedSequence)
       VALUES(?,?,0,'elective',99)`,
      [curriculumSemesters[semesterIndex].id, inserted.id]
    );
    await db.run(
      `INSERT INTO timetable_slots(courseId,day,time,durationMinutes,roomId,termId,programSemester)
       VALUES(?,?,?,60,?,?,?)`,
      [inserted.id, day, time, room.id, termId, semesterIndex + 1]
    );
    return { id: inserted.id, code, credits };
  }
  const overloadCourse = await addOptionalCourse({
    code: 'LCT-OVER', name: 'Lifecycle Overload Elective', credits: 6, termId: term1.id,
    semesterIndex: 0, day: 'Sun', time: '18:00',
  });
  const conflictCourse = await addOptionalCourse({
    code: 'LCT-CONFLICT', name: 'Lifecycle Conflict Elective', credits: 3, termId: term1.id,
    semesterIndex: 0, day: 'Tue', time: '09:00',
  });
  const postGraduationCourse = await addOptionalCourse({
    code: 'LCT-POST', name: 'Lifecycle Post-Graduation Elective', credits: 3, termId: term2.id,
    semesterIndex: 1, day: 'Sun', time: '18:00',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/enrollments', require('../routes/enrollments'));
  app.use('/api/attendance', require('../routes/attendance'));
  app.use('/api/exams', require('../routes/exams'));
  app.use('/api/grades', require('../routes/grades'));
  app.use('/api/progression', require('../routes/progression'));
  app.use('/api/finance', require('../routes/finance'));
  app.use('/api/approvals', require('../routes/approvals'));
  app.use('/api/graduation', require('../routes/graduation'));
  app.use('/api/transcript', require('../routes/transcript'));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, () => resolve(listening));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = {};
  for (const [key, user] of Object.entries(users)) {
    token[key] = jwt.sign(
      { sub: user.id, role: user.role, email: `${key}@lifecycle.test.invalid`, mustChangePassword: false },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  async function call(method, path, authToken, body) {
    const response = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    return { status: response.status, ok: response.ok, data };
  }

  async function expectOk(method, path, authToken, body, expectedStatus) {
    const response = await call(method, path, authToken, body);
    assert.equal(response.ok, true, `${method} ${path} failed (${response.status}): ${JSON.stringify(response.data)}`);
    if (expectedStatus != null) assert.equal(response.status, expectedStatus);
    return response.data;
  }

  async function expectBlocked(method, path, authToken, body, expectedStatus, messagePattern) {
    const response = await call(method, path, authToken, body);
    assert.equal(response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(response.data)}`);
    if (messagePattern) assert.match(String(response.data?.error || ''), messagePattern);
    return response.data;
  }

  async function enroll(course) {
    return expectOk('POST', '/enrollments', token.student, { courseId: course.id }, 201);
  }

  async function setCourseScores(course, ratio) {
    const items = await expectOk('GET', `/grades/items?courseId=${course.id}`, token.faculty);
    assert.equal(items.reduce((sum, item) => sum + Number(item.maxScore), 0), 100);
    for (const item of items) {
      await expectOk('PUT', '/grades/score', token.faculty, {
        gradeItemId: item.id,
        studentId: users.student.id,
        score: Math.round(Number(item.maxScore) * ratio * 100) / 100,
      });
    }
    return expectOk('POST', `/grades/courses/${course.id}/publish`, token.faculty, {});
  }

  async function markAttendance(course, statuses, datePrefix) {
    for (let index = 0; index < statuses.length; index += 1) {
      await expectOk('POST', '/attendance/bulk', token.faculty, {
        slotId: slots.get(course.id),
        date: `${datePrefix}-${String(index + 1).padStart(2, '0')}`,
        entries: [{ studentId: users.student.id, status: statuses[index] }],
      });
    }
  }

  const snapshot = {
    studentId: users.student.id,
    idNumber: 'LIFECYCLE-STUDENT-001',
    department: 'Lifecycle Computing',
    program: 'Lifecycle BSc',
    catalogYear: '2026',
    semester: 1,
    status: 'Active',
    completedCredits: 0,
    cgpa: null,
    financialBalance: 0,
    holds: [],
  };

  await t.test('Semester 1 registration validations and initialization use real routes', async () => {
    const history = await expectOk('GET', `/progression/${users.student.id}/history`, token.student);
    assert.equal(history.length, 1);
    assert.equal(history[0].semesterNumber, 1);
    assert.equal(history[0].termId, term1.id);

    await expectBlocked('POST', '/enrollments', token.student, { courseId: sem1Course2.id }, 409, /Missing prerequisite/);
    await expectBlocked('POST', '/enrollments', token.student, { courseId: sem1Course3.id }, 409, /Missing prerequisite/);

    await enroll(sem1Course1);
    await setCourseScores(sem1Course1, 0.75);
    await enroll(sem1Course4);
    await enroll(sem1Course3);
    await enroll(sem1Course2);
    for (const course of coursesBySemester[0].slice(4)) await enroll(course);

    await expectBlocked('POST', '/enrollments', token.student, { courseId: sem1Course1.id }, 409, /Already enrolled|completed/i);
    await expectBlocked('POST', '/enrollments', token.student, { courseId: overloadCourse.id }, 409, /credit limit/i);
    await expectBlocked('POST', '/enrollments', token.student, { courseId: conflictCourse.id }, 409, /conflicts with a time slot/i);

    const earlyProgression = await expectOk('POST', `/progression/${users.student.id}/evaluate`, token.registrar, {});
    assert.equal(earlyProgression.advanced, false);
    assert.equal(earlyProgression.status, 'Awaiting Results');
    assert.match(earlyProgression.reason, /Not all courses have final grades/);
  });

  const attendanceEvidence = { belowThresholdExamWasBlocked: null, finalPercentages: {} };
  await t.test('Semester 1 attendance, grade publication, GPA, transcript and progression', async () => {
    await markAttendance(sem1Course2, ['absent'], '2026-02');
    const examAccess = await call('GET', `/exams/${exams.get(sem1Course2.id)}`, token.student);
    attendanceEvidence.belowThresholdExamWasBlocked = examAccess.status === 403;
    assert.equal(examAccess.status, 200, 'Current behavior is recorded as a known attendance-enforcement gap');
    await markAttendance(sem1Course2, ['present', 'present', 'present', 'present'], '2026-03');

    for (const course of coursesBySemester[0]) {
      if (course.id !== sem1Course2.id) await markAttendance(course, ['present', 'present', 'present', 'present', 'absent'], '2026-04');
      if (course.id !== sem1Course1.id) await setCourseScores(course, 0.75);
    }

    const attendanceRows = await expectOk('GET', '/attendance/me', token.student);
    for (const course of coursesBySemester[0]) {
      const rows = attendanceRows.filter(row => row.courseId === course.id);
      const percent = rows.filter(row => row.status === 'present' || row.status === 'late').length / rows.length * 100;
      attendanceEvidence.finalPercentages[course.code] = percent;
      approximately(percent, 80);
    }

    const transcript = await expectOk('GET', '/transcript/me', token.student);
    assert.equal(transcript.terms.length, 1);
    assert.equal(transcript.terms[0].courses.length, 6);
    approximately(transcript.terms[0].termGpa, 2);
    approximately(transcript.cumulative.gpa, 2);
    assert.equal(transcript.cumulative.completedCredits, 18);

    await db.run('UPDATE terms SET isActive=0 WHERE id=?', [term1.id]);
    await db.run('UPDATE terms SET isActive=1 WHERE id=?', [term2.id]);
    const progression = await expectOk('POST', `/progression/${users.student.id}/evaluate`, token.registrar, {});
    assert.equal(progression.advanced, true);
    assert.equal(progression.previousSemester, 1);
    assert.equal(progression.semesterNumber, 2);
    const profile = await db.get('SELECT programSemester,semesterStatus,enrollmentStatus FROM student_profiles WHERE studentId=?', [users.student.id]);
    assert.equal(profile.programSemester, 2);
    assert.equal(profile.semesterStatus, 'In Progress');
    assert.equal(profile.enrollmentStatus, 'Regular');
  });

  let application;
  await t.test('Semester 2 incomplete-course and approval permission controls', async () => {
    for (const course of coursesBySemester[1]) await enroll(course);
    application = await expectOk('POST', '/graduation/applications', token.registrar, {
      studentId: users.student.id,
      expectedGraduationTermId: term2.id,
      notes: 'LIFECYCLE TEST DATA',
    }, 201);

    await expectBlocked(
      'POST', `/approvals/${application.approvalRequest.id}/decide`, token.viewer,
      { decision: 'approve', note: 'Unauthorized lifecycle attempt' }, 403, /permission/i
    );
    for (const [reviewer, note] of [
      ['deptHead', 'Department requirements verified'],
      ['registrar', 'Registrar record verified'],
      ['bursar', 'Finance review completed'],
      ['records', 'Academic record approved'],
    ]) {
      await expectOk('POST', `/approvals/${application.approvalRequest.id}/decide`, token[reviewer], {
        decision: 'approve', note,
      });
    }

    const incomplete = await expectBlocked(
      'POST', `/graduation/applications/${application.id}/finalize`, token.records,
      { officialGraduationDate: '2026-12-31' }, 422, /Final graduation validation failed/
    );
    const reasonCodes = new Set(incomplete.details.reasons.map(reason => reason.code));
    assert.ok(reasonCodes.has('REQUIRED_COURSE_MISSING'));
    assert.ok(reasonCodes.has('MISSING_GRADE'));
    assert.ok(reasonCodes.has('ACTIVE_REGISTRATION'));
  });

  await t.test('Failed-course accounting, recovery, attendance and low-CGPA rejection', async () => {
    const failedCourse = coursesBySemester[1][0];
    await setCourseScores(failedCourse, 0);
    const withFailure = await computeAcademicSummary(users.student.id);
    assert.equal(withFailure.completedCredits, 18, 'Failed credits must not be reported as completed');
    assert.equal(withFailure.attemptedCredits, 36);
    assert.equal(withFailure.failedCount, 1);

    await setCourseScores(failedCourse, 0.65);
    for (const course of coursesBySemester[1].slice(1)) await setCourseScores(course, 0.65);
    for (const course of coursesBySemester[1]) {
      await markAttendance(course, ['present', 'present', 'present', 'present', 'absent'], '2026-09');
    }

    const lowGpaAudit = await expectOk('POST', `/graduation/applications/${application.id}/audit`, token.records, {});
    assert.equal(lowGpaAudit.eligible, false);
    assert.ok(lowGpaAudit.reasons.some(reason => reason.code === 'LOW_GPA'));
    approximately(lowGpaAudit.academic.gpa, 1.5);
    await expectBlocked(
      'POST', `/graduation/applications/${application.id}/finalize`, token.records,
      { officialGraduationDate: '2026-12-31' }, 422, /Final graduation validation failed/
    );

    for (const course of coursesBySemester[1]) await setCourseScores(course, 0.9);
    const progression = await expectOk('POST', `/progression/${users.student.id}/evaluate`, token.registrar, {});
    assert.equal(progression.graduationEligible, true);
    assert.equal(progression.status, 'Graduation Eligible');
  });

  let finalized;
  await t.test('Finance hold blocks finalization, payment clears it, and graduation finalizes', async () => {
    await expectOk('PUT', `/finance/terms/${term2.id}/config`, token.admin, { feePerCredit: 100, currency: 'USD' });
    const charges = await expectOk('POST', `/finance/terms/${term2.id}/generate-charges`, token.bursar, {});
    assert.equal(charges.studentsCharged, 1);
    assert.equal(charges.totalAmount, 1800);

    const held = await expectBlocked(
      'POST', `/graduation/applications/${application.id}/finalize`, token.records,
      { officialGraduationDate: '2026-12-31' }, 422, /Final graduation validation failed/
    );
    assert.ok(held.details.reasons.some(reason => reason.code === 'ACTIVE_HOLD' && reason.details.type === 'financial'));

    await expectOk('POST', `/finance/students/${users.student.id}/payments`, token.bursar, {
      amount: 1800, termId: term2.id, method: 'cash', reference: 'LIFECYCLE-TEST-PAYMENT',
    }, 201);
    const clearedAudit = await expectOk('POST', `/graduation/applications/${application.id}/audit`, token.records, {});
    assert.equal(clearedAudit.eligible, true);
    approximately(clearedAudit.academic.gpa, 3);
    assert.equal(clearedAudit.academic.completedCredits, 36);

    finalized = await expectOk(
      'POST', `/graduation/applications/${application.id}/finalize`, token.records,
      { officialGraduationDate: '2026-12-31', notes: 'LIFECYCLE TEST DATA' }, 201
    );
    assert.match(finalized.record.graduateNumber, /^GR-2026-/);
    assert.equal(finalized.record.totalCreditsCompleted, 36);
    approximately(finalized.record.finalGpa, 3);
  });

  const postGraduationEvidence = {};
  await t.test('Post-graduation registry, transcript, restrictions, billing and audit evidence', async () => {
    const registry = await expectOk('GET', '/graduation/registry?search=LIFECYCLE-STUDENT-001', token.records);
    assert.equal(registry.total, 1);
    assert.equal(registry.items[0].studentId, users.student.id);
    assert.equal(registry.items[0].graduateNumber, finalized.record.graduateNumber);

    const transcript = await expectOk('GET', '/transcript/me', token.student);
    assert.equal(transcript.studentStatus, 'Graduated');
    assert.equal(transcript.terms.length, 2);
    assert.equal(transcript.cumulative.completedCredits, 36);
    approximately(transcript.cumulative.gpa, 3);

    const certificate = await expectOk(
      'PATCH', `/graduation/registry/${finalized.record.id}/certificate`, token.records,
      { status: 'issued', notes: 'LIFECYCLE TEST DATA' }
    );
    assert.equal(certificate.certificateStatus, 'issued');
    const issuedTranscript = await expectOk(
      'PATCH', `/graduation/registry/${finalized.record.id}/transcript`, token.records,
      { status: 'ready', notes: 'LIFECYCLE TEST DATA' }
    );
    assert.equal(issuedTranscript.transcriptStatus, 'ready');
    const graduationReports = await expectOk('GET', '/graduation/reports', token.records);
    assert.ok(graduationReports.byProgram.some(row => row.label === 'Lifecycle BSc' && row.value === 1));
    assert.ok(graduationReports.byDepartment.some(row => row.label === 'Lifecycle Computing' && row.value === 1));

    // Negative integrity probe: current grade routes do not recognize graduation finalization as
    // a lock. Prove the behavior, capture it as report evidence, and restore the test transcript.
    await setCourseScores(sem1Course1, 0);
    const mutatedTranscript = await expectOk('GET', '/transcript/me', token.student);
    postGraduationEvidence.finalizedTranscriptWasMutable = mutatedTranscript.cumulative.gpa !== 3
      || mutatedTranscript.cumulative.completedCredits !== 36;
    assert.equal(postGraduationEvidence.finalizedTranscriptWasMutable, true);
    await setCourseScores(sem1Course1, 0.75);
    const restoredTranscript = await expectOk('GET', '/transcript/me', token.student);
    approximately(restoredTranscript.cumulative.gpa, 3);
    assert.equal(restoredTranscript.cumulative.completedCredits, 36);

    await expectBlocked('POST', '/enrollments', token.student, { courseId: postGraduationCourse.id }, 409, /does not permit enrollment/i);
    const progression = await expectOk('POST', `/progression/${users.student.id}/evaluate`, token.registrar, {});
    assert.equal(progression.advanced, false);
    assert.match(progression.reason, /already Passed/);

    postGraduationEvidence.activeEnrollmentCount = (await db.get(
      "SELECT COUNT(*) n FROM enrollments WHERE studentId=? AND status='enrolled'",
      [users.student.id]
    )).n;
    await expectOk('POST', `/finance/terms/${term2.id}/fee-items`, token.admin, {
      name: 'Post-graduation lifecycle billing probe', amount: 25, feeType: 'other', scope: 'university',
    }, 201);
    await expectOk('POST', `/finance/terms/${term2.id}/generate-charges`, token.bursar, {});
    const afterGraduationStatement = await expectOk('GET', `/finance/students/${users.student.id}`, token.bursar);
    postGraduationEvidence.postGraduationBalance = afterGraduationStatement.balance;

    const actions = new Set((await db.all('SELECT action FROM audit_log')).map(row => row.action));
    for (const action of ['mark-attendance', 'set-grade-score', 'publish-results', 'progress-evaluate', 'approval-submit', 'approval-decide', 'generate-charges', 'record-payment', 'graduation-finalize']) {
      assert.ok(actions.has(action), `Missing audit action: ${action}`);
    }
    const notificationTypes = new Set((await db.all('SELECT type FROM notifications WHERE userId=?', [users.student.id])).map(row => row.type));
    for (const type of ['enrollment_succeeded', 'attendance_posted', 'attendance_exam_block', 'grade_published', 'grade_changed', 'progression_succeeded', 'graduation_eligible', 'invoice_generated', 'payment_recorded', 'graduation_finalized']) {
      assert.ok(notificationTypes.has(type), `Missing lifecycle notification: ${type}`);
    }
  });

  const semesterRecords = await db.all(
    'SELECT semesterNumber,status,creditsAttempted,creditsEarned,termGpa,cgpa FROM semester_records WHERE studentId=? ORDER BY semesterNumber',
    [users.student.id]
  );
  const finalProfile = await db.get(
    'SELECT programSemester,studentStatus,semesterStatus,graduationStatus,graduationDate,degreeAwarded FROM student_profiles WHERE studentId=?',
    [users.student.id]
  );
  const finalSummary = await computeAcademicSummary(users.student.id);
  const auditCount = (await db.get('SELECT COUNT(*) n FROM audit_log')).n;
  const notificationCount = (await db.get('SELECT COUNT(*) n FROM notifications WHERE userId=?', [users.student.id])).n;
  console.log(JSON.stringify({
    lifecycleEvidence: {
      isolatedDatabase: ':memory:',
      snapshot,
      curriculum: { id: curriculum.id, semesters: 2, requiredCredits: 36, minimumSemesterCredits: 18, maximumSemesterCredits: 21 },
      semesterRecords,
      finalProfile,
      finalSummary,
      attendanceEvidence,
      postGraduationEvidence,
      graduationRecord: {
        id: finalized.record.id,
        graduateNumber: finalized.record.graduateNumber,
        officialGraduationDate: finalized.record.officialGraduationDate,
        finalGpa: finalized.record.finalGpa,
        totalCreditsCompleted: finalized.record.totalCreditsCompleted,
      },
      auditCount,
      notificationCount,
    },
  }, null, 2));
});

test.todo('grade submission must be rejected outside a configured grade-entry window (no grade-window model exists)');
test.todo('insufficient attendance must block final exam access, not only create a warning notification');
test.todo('graduation finalization must close active enrollments without removing them from GPA and transcript history');
test.todo('graduated students must be excluded from regenerated normal-term billing');
test.todo('finalized and issued transcripts must reject later gradebook mutations');
test.todo('a dedicated alumni record and alumni directory must be created during graduation');
