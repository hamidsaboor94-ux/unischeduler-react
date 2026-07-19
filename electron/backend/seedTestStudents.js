/**
 * One-off seed script: creates 200 test student accounts and enrolls them across the REAL
 * course catalog already in this database — entirely through the same account-creation and
 * enrollment endpoints a real admin/student would use (POST /api/users, POST /api/enrollments),
 * not direct DB inserts for accounts or enrollments. That means every server-side rule (unique
 * email, credit limit, schedule clash, capacity/waitlisting) is enforced exactly as it would be
 * for a real signup — this script never bypasses them, it just tries things and lets rejected
 * attempts be skipped.
 *
 * NOT wired into app startup or `npm run seed` — run it only when you want it:
 *   node src/seedTestStudents.js
 *   node src/seedTestStudents.js --reset   (removes previously-seeded test students first, then reseeds)
 *
 * Idempotent by default: every account this script creates has an @student.local email, and the
 * script refuses to add more on top of an existing batch unless you pass --reset. So re-running
 * it (or the app itself restarting, which never touches this file at all) can't silently pile up
 * duplicate data.
 *
 * Targets the real desktop app's database (%APPDATA%/UniScheduler/database.sqlite) by default —
 * override with DB_PATH=... to point it at a different file instead (e.g. the standalone
 * api/data/database.sqlite dev database).
 *
 * IMPORTANT: close the Electron app (and any other process using this database) before running
 * this — it opens the same SQLite file directly, and SQLite only tolerates one writer at a time.
 */
const path = require('path');
const os = require('os');

const DEFAULT_DB_PATH = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'UniScheduler', 'database.sqlite');
process.env.DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@example.edu';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'UniScheduler2026$';
const TEST_EMAIL_DOMAIN = 'student.local';
const TARGET_STUDENT_COUNT = 200;
const RESET = process.argv.includes('--reset');

// This institution's real course catalog turned out to have no departments assigned to any of
// its 48 courses (a real gap, not something this script should silently paper over) — see the
// summary this script prints for how each course code below was categorized. Only 4 departments
// are genuinely represented in the actual catalog; this deliberately does NOT invent departments
// (e.g. "Business", "Engineering") that have zero matching courses.
const DEPARTMENTS = [
  {
    name: 'Computer Science',
    codes: ['ACN', 'AOA', 'CAAO', 'CCAVT', 'CS', 'DA', 'DCACN', 'DLADD', 'DSAA', 'DWAA', 'DWAA2',
      'MAD', 'MAD2', 'MPLM', 'MPLM4ANA', 'NSAC', 'NSAC2', 'OP', 'OSC', 'SPMS', 'WE', 'WT', 'RM', 'T', 'T2'],
  },
  {
    name: 'Islamic Studies',
    codes: ['ESOI', 'ESOI2', 'ESOI2SSO', 'ESOI2SSO2', 'ESOI3', 'ESOI4', 'IC', 'IC2', 'IS2RAS',
      'IS2RAS2', 'PSOI2ASO', 'PSOI2ASO2', 'QACS', 'QACS2', 'QACS3', 'WSOI2BOP', 'WSOI2BOP2', 'WSOI2BOP3', 'WSOI2BOP4'],
  },
  { name: 'Humanities & Social Sciences', codes: ['EL', 'HOA', 'HOA2'] },
  { name: 'Mathematics', codes: ['LA'] },
];

// Deliberately capped small so seeding 200 students actually exercises waitlisting — everything
// else gets a plausible, generous default. Only applied to courses with NO existing maxStudents
// (never overwrites a cap someone already configured).
const SMALL_CAP_CODES = ['OP', 'DSAA', 'DLADD'];

const FIRST_NAMES = [
  'Ahmad', 'Mohammad', 'Abdul', 'Najibullah', 'Waliullah', 'Rahim', 'Karim', 'Farid', 'Zabihullah',
  'Mirwais', 'Fazal', 'Noorullah', 'Rukhnuddin', 'Ashabudin', 'Naqibullah', 'Hekmatullah', 'Ehsanullah',
  'Obaidullah', 'Sayed', 'Bilal', 'Jawad', 'Yama', 'Homayoun', 'Shafiq', 'Rohullah', 'Zia', 'Nasratullah',
  'Sediqullah', 'Wahidullah', 'Ismail', 'Fahim', 'Freshta', 'Roya', 'Zainab', 'Fatima', 'Marwa', 'Wazhma',
  'Nilofar', 'Storai', 'Shakila', 'Maryam', 'Aziz', 'Suhrab',
];
const LAST_NAMES = [
  'Ahmadi', 'Karimi', 'Rahimi', 'Popalzai', 'Noori', 'Ibrahimi', 'Shirzad', 'Aryan', 'Safi', 'Zahid',
  'Halimi', 'Shinwari', 'Hotak', 'Barakzai', 'Achakzai', 'Andar', 'Khalili', 'Sadiqi', 'Mohammadi',
  'Yousafzai', 'Wardak', 'Kakar', 'Tarin', 'Alokozai', 'Farahi', 'Nazari', 'Sultani', 'Rasooli',
  'Sarwari', 'Basir', 'Faizi', 'Qaderi', 'Sherzai', 'Ghafoori', 'Jalali',
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function main() {
  const { init, all, run } = require('./db');
  await init();

  const app = require('./app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.on('listening', resolve); server.on('error', reject); });
  const BASE = `http://127.0.0.1:${server.address().port}/api`;

  async function api(token, method, p, body) {
    const res = await fetch(BASE + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) { const err = new Error((data && data.error) || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return data;
  }

  console.log(`Database: ${process.env.DB_PATH}`);
  console.log('Logging in as admin (real /auth/login, same as the app) ...');
  const login = await api(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const adminToken = login.token;
  console.log(`Logged in as ${login.user.email}.\n`);

  // --- Idempotency guard --------------------------------------------------
  const existingStudents = await api(adminToken, 'GET', '/users?role=student');
  const existingTestStudents = existingStudents.filter(u => u.email.endsWith('@' + TEST_EMAIL_DOMAIN));
  if (existingTestStudents.length && !RESET) {
    console.log(`Found ${existingTestStudents.length} previously-seeded test students (@${TEST_EMAIL_DOMAIN}).`);
    console.log('Refusing to add more on top of them, to avoid duplicating data.');
    console.log('Re-run with --reset to remove them first and reseed a fresh batch of 200.');
    server.close();
    return;
  }
  if (existingTestStudents.length && RESET) {
    console.log(`--reset: removing ${existingTestStudents.length} previously-seeded test students first...`);
    for (const u of existingTestStudents) {
      const enrollments = await all('SELECT id FROM enrollments WHERE studentId = ?', [u.id]);
      for (const e of enrollments) await api(adminToken, 'DELETE', `/enrollments/${e.id}`);
      await api(adminToken, 'DELETE', `/users/${u.id}`);
    }
    console.log('Removed.\n');
  }

  // --- Departments: create only the ones this catalog actually needs, reuse if already there ---
  const existingDepts = await api(adminToken, 'GET', '/departments');
  const deptIdByName = {};
  const deptCreated = [];
  for (const d of DEPARTMENTS) {
    let existing = existingDepts.find(x => x.name === d.name);
    if (!existing) {
      existing = await api(adminToken, 'POST', '/departments', { name: d.name });
      deptCreated.push(d.name);
    }
    deptIdByName[d.name] = existing.id;
  }
  console.log(deptCreated.length ? `Created departments: ${deptCreated.join(', ')}` : 'Departments already existed — reused them.');

  // --- Assign every existing course to its department, based on the mapping above ---
  const codeToDeptName = {};
  for (const d of DEPARTMENTS) for (const code of d.codes) codeToDeptName[code] = d.name;

  const courses = await api(adminToken, 'GET', '/courses');
  let coursesAssigned = 0, capsSet = 0;
  const unmapped = [];
  for (const course of courses) {
    const deptName = codeToDeptName[course.code];
    if (!deptName) { unmapped.push(course.code); continue; }
    const deptId = deptIdByName[deptName];
    if (course.departmentId !== deptId) {
      await api(adminToken, 'PUT', `/courses/${course.id}`, { departmentId: deptId });
      coursesAssigned++;
    }
    if (course.maxStudents == null) {
      const cap = SMALL_CAP_CODES.includes(course.code) ? randomInt(10, 14) : randomInt(18, 28);
      await api(adminToken, 'PUT', `/courses/${course.id}`, { maxStudents: cap });
      capsSet++;
    }
  }
  console.log(`Assigned departments to ${coursesAssigned} course(s); set a capacity on ${capsSet} course(s) that had none.`);
  if (unmapped.length) console.log(`Note: ${unmapped.length} course(s) didn't match the department mapping and were left alone: ${unmapped.join(', ')}`);

  const freshCourses = await api(adminToken, 'GET', '/courses');
  const courseIdsByDept = {};
  for (const course of freshCourses) {
    const deptName = codeToDeptName[course.code];
    if (!deptName) continue;
    (courseIdsByDept[deptName] ||= []).push(course.id);
  }

  // --- Generate 200 unique students, created through the real account-creation endpoint ---
  const usedEmails = new Set(existingStudents.map(u => u.email.toLowerCase()));
  const created = [];
  let attempts = 0;
  while (created.length < TARGET_STUDENT_COUNT && attempts < TARGET_STUDENT_COUNT * 6) {
    attempts++;
    const first = FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)];
    const last = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)];
    const emailBase = `${first}.${last}`.toLowerCase();
    let email = `${emailBase}@${TEST_EMAIL_DOMAIN}`;
    let suffix = 1;
    while (usedEmails.has(email)) { suffix++; email = `${emailBase}${suffix}@${TEST_EMAIL_DOMAIN}`; }
    usedEmails.add(email);
    try {
      const result = await api(adminToken, 'POST', '/users', { name: `${first} ${last}`, email, role: 'student' });
      created.push({ id: result.user.id, name: `${first} ${last}`, email, idNumber: result.user.idNumber, tempPassword: result.tempPassword });
    } catch (err) {
      console.log(`  (skipped ${email}: ${err.message})`);
    }
  }
  console.log(`\nCreated ${created.length} student accounts via POST /api/users (mustChangePassword=1, same as any real new account).`);

  // --- Enroll each student across a realistic course mix, letting the real enrollment
  //     endpoint's own rules (credit limit, schedule clash, capacity/waitlist) decide what
  //     actually sticks. Every student gets 1-2 Islamic Studies courses (the catalog's general-
  //     ed courses, heavily sectioned) plus 3-5 Computer Science courses (the only real major
  //     this catalog supports — Math/Humanities have just 1 and 3 courses respectively, so they
  //     act as occasional electives, not alternate majors). ---
  const stats = { enrolled: 0, waitlisted: 0, rejectedCredit: 0, rejectedClash: 0, rejectedOther: 0 };
  const enrollmentsByDept = {};

  function pickCandidateCourseIds() {
    // Generous candidate lists — this catalog's real timetable is densely packed, so a lot of
    // random picks will collide with each other. Offering more candidates than a student will
    // actually end up enrolled in isn't "over-enrolling": every one still goes through the real
    // enrollment endpoint and only sticks if it doesn't clash/exceed credits/exceed capacity.
    const islamic = shuffle(courseIdsByDept['Islamic Studies'] || []).slice(0, randomInt(2, 4));
    const cs = shuffle(courseIdsByDept['Computer Science'] || []).slice(0, randomInt(6, 10));
    const electives = shuffle([...(courseIdsByDept['Mathematics'] || []), ...(courseIdsByDept['Humanities & Social Sciences'] || [])]).slice(0, randomInt(1, 3));
    return shuffle([...islamic, ...cs, ...electives]);
  }
  const deptByCourseId = {};
  for (const course of freshCourses) if (codeToDeptName[course.code]) deptByCourseId[course.id] = codeToDeptName[course.code];

  for (const student of created) {
    for (const courseId of pickCandidateCourseIds()) {
      try {
        const enr = await api(adminToken, 'POST', '/enrollments', { studentId: student.id, courseId });
        if (enr.status === 'waitlisted') stats.waitlisted++; else stats.enrolled++;
        const dept = deptByCourseId[courseId] || 'Unmapped';
        enrollmentsByDept[dept] = (enrollmentsByDept[dept] || 0) + 1;
      } catch (err) {
        if (/credit limit/i.test(err.message)) stats.rejectedCredit++;
        else if (/conflict/i.test(err.message)) stats.rejectedClash++;
        else stats.rejectedOther++;
      }
    }
  }

  // --- Verification pass: confirm nothing actually violates the rules we care about ---
  const term = await api(adminToken, 'GET', '/terms').then(ts => ts.find(t => t.isActive));
  const violations = [];
  for (const student of created) {
    const roster = await all(
      `SELECT c.credits FROM enrollments e JOIN courses c ON c.id = e.courseId WHERE e.studentId = ? AND e.status = 'enrolled'`,
      [student.id]
    );
    const totalCredits = roster.reduce((sum, r) => sum + (r.credits || 0), 0);
    if (term && term.creditLimit != null && totalCredits > term.creditLimit) {
      violations.push(`${student.name} has ${totalCredits} credits, over the ${term.creditLimit}-credit limit`);
    }
  }
  for (const course of freshCourses) {
    if (course.maxStudents == null) continue;
    const enrolledCount = await all(`SELECT id FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [course.id]);
    if (enrolledCount.length > course.maxStudents) {
      violations.push(`${course.code} has ${enrolledCount.length} enrolled against a ${course.maxStudents} cap`);
    }
  }

  // --- Write out credentials for testing logins (temp passwords are shown once, same as the real app) ---
  const fs = require('fs');
  const outPath = path.join(__dirname, '..', 'seed-test-students-credentials.csv');
  const csvLines = ['idNumber,name,email,tempPassword', ...created.map(s => `${s.idNumber},"${s.name}",${s.email},${s.tempPassword}`)];
  fs.writeFileSync(outPath, csvLines.join('\n'), 'utf8');

  server.close();

  // --- Summary ---
  console.log('\n================ SEED SUMMARY ================');
  console.log(`Students created: ${created.length} / ${TARGET_STUDENT_COUNT}`);
  console.log('\nDepartments (course catalog mapping):');
  for (const d of DEPARTMENTS) console.log(`  ${d.name}: ${d.codes.length} course(s)`);
  console.log('\nEnrollment attempts:');
  console.log(`  Enrolled:              ${stats.enrolled}`);
  console.log(`  Waitlisted (course full): ${stats.waitlisted}`);
  console.log(`  Rejected (credit limit): ${stats.rejectedCredit}`);
  console.log(`  Rejected (schedule clash): ${stats.rejectedClash}`);
  console.log(`  Rejected (other):       ${stats.rejectedOther}`);
  console.log('\nSuccessful enrollments by department:');
  for (const [dept, count] of Object.entries(enrollmentsByDept)) console.log(`  ${dept}: ${count}`);
  console.log(`\nConstraint check: ${violations.length === 0 ? 'PASSED — no credit-limit or capacity violations found.' : 'FAILED:'}`);
  for (const v of violations) console.log(`  - ${v}`);
  console.log(`\nCredentials for all ${created.length} test accounts (idNumber, name, email, temp password) written to:\n  ${outPath}`);
  console.log('================================================\n');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
