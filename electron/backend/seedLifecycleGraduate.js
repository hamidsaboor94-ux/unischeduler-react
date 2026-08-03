/**
 * Creates one persistent, clearly-labelled demonstration graduate through the real HTTP routes.
 * Configuration fixtures are inserted directly; enrollment, attendance, gradebook publication,
 * progression, finance clearance, approvals and graduation all use the running API.
 *
 * Required safeguards:
 *   DB_PATH=<explicit sqlite file> LIFECYCLE_API_BASE=http://127.0.0.1:4000/api
 *   node seedLifecycleGraduate.js --confirm-live
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { JWT_SECRET } = require('./middleware/auth');

const EMAIL = 'lifecycle.demo.student@ums.invalid';
const ID_NUMBER = 'LIFECYCLE-DEMO-001';
const MARKER = 'LIFECYCLE DEMO DATA';
const API_BASE = process.env.LIFECYCLE_API_BASE || 'http://127.0.0.1:4000/api';

function requireSafetyConfirmation() {
  if (!process.argv.includes('--confirm-live')) throw new Error('Refusing to run without --confirm-live.');
  if (!process.env.DB_PATH || process.env.DB_PATH === ':memory:') {
    throw new Error('Set DB_PATH explicitly to the target SQLite database.');
  }
}

async function backupTarget() {
  const dir = path.join(path.dirname(db.DB_PATH), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(dir, `pre-lifecycle-demo-${stamp}.sqlite`);
  await db.backupTo(destination);
  return destination;
}

async function insertUser(name, role, email) {
  const result = await db.run(
    'INSERT INTO users(name,email,role,mustChangePassword) VALUES(?,?,?,0)',
    [name, email, role]
  );
  return { id: result.id, name, role, email };
}

function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, mustChangePassword: false },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

async function call(method, route, token, body) {
  const response = await fetch(API_BASE + route, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw Object.assign(new Error(`${method} ${route} failed (${response.status}): ${data?.error || text}`), {
      status: response.status,
      data,
    });
  }
  return data;
}

async function setOnlyActiveTerm(termId) {
  await db.run('UPDATE terms SET isActive=0');
  await db.run('UPDATE terms SET isActive=1 WHERE id=?', [termId]);
}

async function main() {
  requireSafetyConfirmation();
  await db.init();

  const existing = await db.get('SELECT id,name FROM users WHERE email=? COLLATE NOCASE', [EMAIL]);
  if (existing) {
    const record = await db.get(
      `SELECT gr.*,sp.studentStatus,sp.semesterStatus FROM graduation_records gr
       JOIN student_profiles sp ON sp.studentId=gr.studentId WHERE gr.studentId=? ORDER BY gr.id DESC LIMIT 1`,
      [existing.id]
    );
    if (record?.finalizedAt) {
      console.log(JSON.stringify({ alreadyExists: true, student: existing, record }, null, 2));
      return;
    }
    throw new Error(`A partial lifecycle demo student already exists with id ${existing.id}; inspect it before retrying.`);
  }

  const backupFile = await backupTarget();
  const originalActiveTerms = await db.all('SELECT id FROM terms WHERE isActive=1 ORDER BY id');
  let student;
  try {
    const adminRow = await db.get("SELECT id,name,email,role FROM users WHERE role='admin' ORDER BY id LIMIT 1");
    if (!adminRow) throw new Error('No admin account exists for lifecycle setup.');
    const admin = { ...adminRow, email: adminRow.email || 'admin@ums.invalid' };
    const faculty = await insertUser('Lifecycle Demo Faculty', 'faculty', 'lifecycle.demo.faculty@ums.invalid');
    const deptHead = await insertUser('Lifecycle Demo Department Head', 'dept_head', 'lifecycle.demo.depthead@ums.invalid');
    const registrar = await insertUser('Lifecycle Demo Registrar', 'registrar', 'lifecycle.demo.registrar@ums.invalid');
    const bursar = await insertUser('Lifecycle Demo Bursar', 'bursar', 'lifecycle.demo.bursar@ums.invalid');
    const records = await insertUser('Lifecycle Demo Records Officer', 'records_officer', 'lifecycle.demo.records@ums.invalid');
    student = await insertUser('Lifecycle Demo Graduate', 'student', EMAIL);
    await db.run('UPDATE users SET idNumber=? WHERE id=?', [ID_NUMBER, student.id]);

    const college = await db.run("INSERT INTO colleges(name) VALUES('Lifecycle Demo College')");
    const department = await db.run("INSERT INTO departments(name,collegeId) VALUES('Lifecycle Demo Computing',?)", [college.id]);
    await db.run('UPDATE users SET departmentId=? WHERE id=?', [department.id, deptHead.id]);
    const program = await db.run(
      "INSERT INTO programs(name,departmentId,degreeLevel,totalCredits,numberOfSemesters) VALUES('Lifecycle Demo BSc',?,'BSc',36,2)",
      [department.id]
    );
    const teacher = await db.run(
      "INSERT INTO teachers(name,departmentId,userId) VALUES('Lifecycle Demo Faculty',?,?)",
      [department.id, faculty.id]
    );
    const room = await db.run("INSERT INTO rooms(name,type,capacity) VALUES('Lifecycle Demo Room','Classroom',60)");
    const opens = '2026-01-01T00:00:00.000Z';
    const closes = '2027-12-31T23:59:59.999Z';
    const term1 = await db.run(
      `INSERT INTO terms(name,startDate,endDate,isActive,creditLimit,registrationOpensAt,registrationClosesAt)
       VALUES('Lifecycle Demo Semester 1','2026-01-01','2026-06-30',0,21,?,?)`, [opens, closes]
    );
    const term2 = await db.run(
      `INSERT INTO terms(name,startDate,endDate,isActive,creditLimit,registrationOpensAt,registrationClosesAt)
       VALUES('Lifecycle Demo Semester 2','2026-07-01','2026-12-31',0,21,?,?)`, [opens, closes]
    );
    await db.run(
      `INSERT INTO student_profiles(studentId,departmentId,programId,programSemester,studentStatus,enrollmentStatus,
       enrollmentDate,semesterStatus,batch) VALUES(?,?,?,1,'Active','Regular','2026-01-01','In Progress',?)`,
      [student.id, department.id, program.id, MARKER]
    );
    const curriculum = await db.run(
      `INSERT INTO curriculum(programId,curriculumName,status,totalCredits,totalRequiredCredits,catalogYear,academicYear)
       VALUES(?,'Lifecycle Demo Curriculum 2026','active',36,36,'2026','2026')`, [program.id]
    );
    const curriculumSemesters = [];
    for (const semesterNumber of [1, 2]) {
      curriculumSemesters.push(await db.run(
        `INSERT INTO curriculum_semester(curriculumId,semesterNumber,name,minimumCredits,maximumCredits)
         VALUES(?,?,?,18,21)`, [curriculum.id, semesterNumber, `Semester ${semesterNumber}`]
      ));
    }
    await db.run(
      `INSERT INTO student_curriculum(studentId,curriculumId,status,assignedBy,notes)
       VALUES(?,?,'active',?,?)`, [student.id, curriculum.id, admin.id, MARKER]
    );
    await db.run(
      `INSERT INTO student_curriculum_history(studentId,curriculumId,status,assignedBy,notes)
       VALUES(?,?,'active',?,?)`, [student.id, curriculum.id, admin.id, MARKER]
    );
    await db.run(
      "INSERT INTO settings(key,value) VALUES('graduationMinimumGpa','2.0') ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    );

    const courses = [[], []];
    const slots = new Map();
    for (const semesterNumber of [1, 2]) {
      const termId = semesterNumber === 1 ? term1.id : term2.id;
      for (let index = 1; index <= 6; index += 1) {
        const code = `LDEM${semesterNumber}${String(index).padStart(2, '0')}`;
        const inserted = await db.run(
          `INSERT INTO courses(code,name,departmentId,credits,teacherId,roomId,maxStudents,termId,programId)
           VALUES(?,?,?,3,?,?,50,?,?)`,
          [code, `Lifecycle Demo Semester ${semesterNumber} Course ${index}`, department.id, teacher.id, room.id, termId, program.id]
        );
        const course = { id: inserted.id, code, credits: 3 };
        courses[semesterNumber - 1].push(course);
        await db.run(
          `INSERT INTO curriculum_course(curriculumSemesterId,courseId,required,courseType,minimumPassingGrade,recommendedSequence)
           VALUES(?,?,1,'required','D',?)`,
          [curriculumSemesters[semesterNumber - 1].id, course.id, index]
        );
        const slot = await db.run(
          `INSERT INTO timetable_slots(courseId,day,time,durationMinutes,roomId,termId,programSemester)
           VALUES(?,?,?,60,?,?,?)`,
          [course.id, ['Mon','Tue','Wed','Thu','Fri','Sat'][index - 1], `${String(7 + index).padStart(2,'0')}:00`, room.id, termId, semesterNumber]
        );
        slots.set(course.id, slot.id);
      }
    }
    await db.run(
      "INSERT INTO course_prerequisites(courseId,prerequisiteCourseId,type) VALUES(?,?,'prerequisite')",
      [courses[0][1].id, courses[0][0].id]
    );

    const tokens = {
      admin: tokenFor(admin), faculty: tokenFor(faculty), deptHead: tokenFor(deptHead),
      registrar: tokenFor(registrar), bursar: tokenFor(bursar), records: tokenFor(records),
      student: tokenFor(student),
    };
    const gradeCourse = async (course, ratio) => {
      const items = await call('GET', `/grades/items?courseId=${course.id}`, tokens.faculty);
      for (const item of items) {
        await call('PUT', '/grades/score', tokens.faculty, {
          gradeItemId: item.id,
          studentId: student.id,
          score: Math.round(Number(item.maxScore) * ratio * 100) / 100,
        });
      }
      await call('POST', `/grades/courses/${course.id}/publish`, tokens.faculty, {});
    };
    const attendanceCourse = async (course, month) => {
      const statuses = ['present','present','present','present','absent'];
      for (let index = 0; index < statuses.length; index += 1) {
        await call('POST', '/attendance/bulk', tokens.faculty, {
          slotId: slots.get(course.id),
          date: `2026-${month}-${String(index + 1).padStart(2,'0')}`,
          entries: [{ studentId: student.id, status: statuses[index] }],
        });
      }
    };
    const scheduleExam = (course, semesterNumber, index) => call('POST', '/exams', tokens.admin, {
      courseId: course.id,
      date: semesterNumber === 1 ? '2026-06-20' : '2026-12-20',
      time: `${String(8 + index).padStart(2, '0')}:00`,
      durationMinutes: 120,
      roomId: room.id,
      invigilatorId: teacher.id,
      termId: semesterNumber === 1 ? term1.id : term2.id,
      type: 'final',
    });

    await setOnlyActiveTerm(term1.id);
    await call('GET', `/progression/${student.id}/history`, tokens.student);
    await call('POST', '/enrollments', tokens.student, { courseId: courses[0][0].id });
    await scheduleExam(courses[0][0], 1, 0);
    await attendanceCourse(courses[0][0], '02');
    await gradeCourse(courses[0][0], 0.75);
    for (const [index, course] of courses[0].slice(1).entries()) {
      await call('POST', '/enrollments', tokens.student, { courseId: course.id });
      await scheduleExam(course, 1, index + 1);
      await attendanceCourse(course, '02');
      await gradeCourse(course, 0.75);
    }

    await setOnlyActiveTerm(term2.id);
    await call('POST', `/progression/${student.id}/evaluate`, tokens.registrar, {});
    for (const [index, course] of courses[1].entries()) {
      await call('POST', '/enrollments', tokens.student, { courseId: course.id });
      await scheduleExam(course, 2, index);
      await attendanceCourse(course, '09');
      await gradeCourse(course, 0.9);
    }
    const progression = await call('POST', `/progression/${student.id}/evaluate`, tokens.registrar, {});
    if (!progression.graduationEligible) throw new Error('Lifecycle demo did not reach graduation eligibility.');

    await call('PUT', `/finance/terms/${term2.id}/config`, tokens.admin, { feePerCredit: 100, currency: 'USD' });
    await call('POST', `/finance/terms/${term2.id}/generate-charges`, tokens.bursar, {});
    await call('POST', `/finance/students/${student.id}/payments`, tokens.bursar, {
      amount: 1800, termId: term2.id, method: 'cash', reference: 'LIFECYCLE-DEMO-PAID', note: MARKER,
    });

    const application = await call('POST', '/graduation/applications', tokens.registrar, {
      studentId: student.id, expectedGraduationTermId: term2.id, notes: MARKER,
    });
    for (const [reviewer, note] of [
      ['deptHead','Lifecycle demo department review complete'],
      ['registrar','Lifecycle demo registrar review complete'],
      ['bursar','Lifecycle demo finance clearance complete'],
      ['records','Lifecycle demo final academic approval complete'],
    ]) {
      await call('POST', `/approvals/${application.approvalRequest.id}/decide`, tokens[reviewer], {
        decision: 'approve', note,
      });
    }
    const finalized = await call('POST', `/graduation/applications/${application.id}/finalize`, tokens.records, {
      officialGraduationDate: '2026-12-31', notes: MARKER,
    });
    const transcript = await call('GET', '/transcript/me', tokens.student);
    const attendance = await call('GET', '/attendance/me', tokens.student);
    const notifications = await call('GET', '/notifications?pageSize=200', tokens.student);
    console.log(JSON.stringify({
      created: true,
      backupFile,
      student: { id: student.id, name: student.name, email: student.email, idNumber: ID_NUMBER },
      graduate: finalized.record,
      transcript: transcript.cumulative,
      transcriptTerms: transcript.terms.length,
      attendanceRecords: attendance.length,
      examsScheduled: 12,
      notificationCount: notifications.total ?? notifications.length,
    }, null, 2));
  } finally {
    await db.run('UPDATE terms SET isActive=0');
    for (const term of originalActiveTerms) await db.run('UPDATE terms SET isActive=1 WHERE id=?', [term.id]);
  }
}

main().catch(error => {
  console.error(`Lifecycle demo creation failed: ${error.message}`);
  process.exit(1);
});
