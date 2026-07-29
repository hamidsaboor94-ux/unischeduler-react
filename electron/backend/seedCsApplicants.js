/**
 * One-off seed script: creates 200 Computer Science applicants entirely through the real
 * admissions pipeline — POST /api/applications (the public application form's own endpoint,
 * same one a real applicant's browser calls) followed by POST /api/applications/:id/approve
 * (the same button an admissions officer clicks in the Applications page). Nothing here inserts
 * into `applications`, `users`, or `student_profiles` directly — every row those tables end up
 * with was produced by that real route code, so it passed the same validation (validateIntakeBody),
 * got the same auto-generated login (idNumber@<institution's configured emailDomain>, via the
 * same createAccountWithTempPassword() used for every account in this app), and left the same
 * audit-log / notification trail a real applicant + real approval would.
 *
 * Usage:
 *   node src/seedCsApplicants.js
 *
 * Targets whatever database db.js would open by default (DB_PATH env var, else
 * api/data/database.sqlite) — override with DB_PATH=... to point it elsewhere. Backs up that
 * .db file (plain file copy, before the database is even opened) to
 * <file>.backup-YYYYMMDD-HHMMSS next to it before touching anything, same naming convention as
 * this project's existing manual backups.
 *
 * Idempotent: every applicant this script would create has a fully deterministic name and
 * personalEmail (seeded PRNG, not Math.random() — re-running produces the exact same 200
 * identities in the exact same order every time). Before creating student #N, it checks for an
 * existing `applications` row with that exact personalEmail:
 *   - already Accepted (has a live student account)         -> skipped, nothing done
 *   - exists but not yet Accepted (a previous run stopped early) -> resumes: approves that
 *     existing application instead of submitting a duplicate one
 *   - doesn't exist yet                                       -> submitted, then approved
 * So re-running this script after a partial or full previous run never creates duplicates and
 * never touches any application/account this script didn't itself create.
 *
 * Never deletes or modifies anything else — no existing student, course, department, or other
 * row is touched. The only mutations are new INSERTs the real /applications and
 * /applications/:id/approve handlers make on their own.
 *
 * Note: going through the *real* public submit endpoint means the *real* side effects fire too —
 * every admin account gets an in-app notification for each of the 200 submissions (see
 * notifyAdmins() in routes/applications.js), and the approval step tries to send a real welcome
 * email (silently a no-op unless SMTP_HOST is configured — see mailer.js). That's expected: this
 * script deliberately doesn't take a shortcut around any of that.
 */
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// --- Editable distribution — must sum to the applicant count below. ---
const SEMESTER_COUNTS = [35, 35, 35, 35, 35, 25]; // semesters 1..6, = 200
const TOTAL_APPLICANTS = SEMESTER_COUNTS.reduce((a, b) => a + b, 0);

const DEPARTMENT_NAME = 'Computer Science';
// Fixed, never-changing seed — this is what makes the generated identities reproducible run to
// run (a real Math.random() would pick a different 200 people every time, breaking idempotency).
const PRNG_SEED = 424242;

function backupTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// --- Resolve DB_PATH exactly the way db.js will, and back the file up BEFORE db.js (or
// anything else) ever opens it — a copy taken while a connection is open risks capturing a
// half-written page; copying first, while nothing holds the file, avoids that entirely. ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'database.sqlite');
if (DB_PATH !== ':memory:' && fs.existsSync(DB_PATH)) {
  const backupPath = `${DB_PATH}.backup-${backupTimestamp()}`;
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`Backed up ${DB_PATH}\n            -> ${backupPath}`);
} else if (DB_PATH !== ':memory:') {
  console.log(`No existing database file at ${DB_PATH} — nothing to back up (a fresh one will be created).`);
}

// mulberry32 — tiny deterministic PRNG. Same seed -> same output sequence, every run, forever.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(PRNG_SEED);
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function randomInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }

// Afghan given-name pools, split by gender so the generated `gender` field matches the name —
// same cultural/linguistic context as this app's other trilingual (en/ps/prs) content.
const MALE_FIRST_NAMES = [
  'Ahmad', 'Mohammad', 'Abdul', 'Najibullah', 'Waliullah', 'Rahim', 'Karim', 'Farid', 'Zabihullah',
  'Mirwais', 'Fazal', 'Noorullah', 'Naqibullah', 'Hekmatullah', 'Ehsanullah', 'Obaidullah', 'Sayed',
  'Bilal', 'Jawad', 'Yama', 'Homayoun', 'Shafiq', 'Rohullah', 'Zia', 'Nasratullah', 'Sediqullah',
  'Wahidullah', 'Ismail', 'Fahim', 'Aziz', 'Suhrab', 'Emal', 'Ajmal', 'Khalid', 'Tariq',
];
const FEMALE_FIRST_NAMES = [
  'Freshta', 'Roya', 'Zainab', 'Fatima', 'Marwa', 'Wazhma', 'Nilofar', 'Storai', 'Shakila', 'Maryam',
  'Zarghuna', 'Palwasha', 'Muska', 'Tamana', 'Suraya', 'Laila', 'Diba', 'Farishta', 'Sonia', 'Hasina',
];
const LAST_NAMES = [
  'Ahmadi', 'Karimi', 'Rahimi', 'Popalzai', 'Noori', 'Ibrahimi', 'Shirzad', 'Aryan', 'Safi', 'Zahid',
  'Halimi', 'Shinwari', 'Hotak', 'Barakzai', 'Achakzai', 'Andar', 'Khalili', 'Sadiqi', 'Mohammadi',
  'Yousafzai', 'Wardak', 'Kakar', 'Tarin', 'Alokozai', 'Farahi', 'Nazari', 'Sultani', 'Rasooli',
  'Sarwari', 'Basir', 'Faizi', 'Qaderi', 'Sherzai', 'Ghafoori', 'Jalali',
];
const CITIES = ['Kabul', 'Herat', 'Mazar-i-Sharif', 'Kandahar', 'Jalalabad', 'Kunduz', 'Ghazni'];
const SCHOOLS = ['Ghazi High School', 'Habibia High School', 'Rabia Balkhi High School', 'Amani High School', 'Esteqlal High School'];

/** Deterministic identity for applicant #n (1-based) — same n always produces the same person,
    on this run or any future one. */
function applicantFor(n) {
  const gender = rng() < 0.45 ? 'Female' : 'Male';
  const first = pick(gender === 'Female' ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES);
  const last = pick(LAST_NAMES);
  const city = pick(CITIES);
  const school = pick(SCHOOLS);
  const birthYear = new Date().getFullYear() - randomInt(18, 23);
  const birthMonth = String(randomInt(1, 12)).padStart(2, '0');
  const birthDay = String(randomInt(1, 28)).padStart(2, '0');
  return {
    n,
    fullName: `${first} ${last}`,
    // Deterministic AND guaranteed-unique across all 200 (the index suffix), which is exactly
    // what makes it a safe idempotency key — the same applicant #n always maps to the same
    // personalEmail, so re-runs can recognize "already submitted" by looking this up.
    personalEmail: `${first}.${last}${n}@gmail.com`.toLowerCase(),
    fatherName: `${pick(MALE_FIRST_NAMES)} ${last}`,
    grandfatherName: pick(MALE_FIRST_NAMES),
    gender,
    dateOfBirth: `${birthYear}-${birthMonth}-${birthDay}`,
    nationality: 'Afghan',
    mobileNumber: `07${randomInt(10000000, 99999999)}`,
    presentAddress: `${city}, Afghanistan`,
    permanentAddress: `${city}, Afghanistan`,
    emergencyContact: `07${randomInt(10000000, 99999999)}`,
    previousSchoolName: school,
    previousGraduationYear: birthYear + 18,
    entryTestMarks: randomInt(60, 96),
  };
}

/** Which of the SEMESTER_COUNTS buckets applicant #n (1-based) falls into. */
function semesterFor(n) {
  let cursor = 0;
  for (let sem = 0; sem < SEMESTER_COUNTS.length; sem++) {
    cursor += SEMESTER_COUNTS[sem];
    if (n <= cursor) return sem + 1;
  }
  return SEMESTER_COUNTS.length; // unreachable given the loop below never exceeds the total
}

async function main() {
  if (TOTAL_APPLICANTS !== 200) {
    console.warn(`Note: SEMESTER_COUNTS sums to ${TOTAL_APPLICANTS}, not the usual 200 — proceeding with that total.`);
  }

  const { init, get, all } = require('./db');
  await init();

  const csDept = await get('SELECT id, name FROM departments WHERE name = ?', [DEPARTMENT_NAME]);
  if (!csDept) throw new Error(`Department "${DEPARTMENT_NAME}" does not exist in this database — create it first.`);
  const csProgram = await get('SELECT id, name FROM programs WHERE departmentId = ?', [csDept.id]);
  console.log(`Target department: ${csDept.name} (id ${csDept.id}).`);
  console.log(csProgram
    ? `Found a program under it: "${csProgram.name}" — will be recorded on each student's profile.`
    : 'No program row exists under this department — skipping program assignment (nothing to attach).');

  const adminRow = await get(`SELECT id, email, role, departmentId, collegeId, mustChangePassword FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
  if (!adminRow) throw new Error('No Super Admin account exists in this database — cannot approve applications without one.');
  if (adminRow.mustChangePassword) {
    throw new Error(`Admin account ${adminRow.email} still has a forced password reset pending — log in and set a real password before running this script.`);
  }
  // A token is minted directly (rather than calling POST /auth/login) so this script never needs
  // to know — or store anywhere — the real admin's password. It carries the exact same claims
  // login would produce for this account, so every downstream permission/ownership check behaves
  // identically to that admin actually being logged in.
  const { JWT_SECRET } = require('./middleware/auth');
  const adminToken = jwt.sign(
    { sub: adminRow.id, role: adminRow.role, departmentId: adminRow.departmentId ?? null, collegeId: adminRow.collegeId ?? null, departmentIds: null, email: adminRow.email, mustChangePassword: false },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
  console.log(`Acting as Super Admin: ${adminRow.email} (token minted locally, no password needed).\n`);

  // The public form's rate limiter (5 submissions/hour/IP by default) has to be raised for this
  // process — it's read once at require-time, so it must be set before requiring app.js. This is
  // the same env-var override the app already exposes for exactly this kind of bulk/legitimate use.
  process.env.APPLICATION_RATE_LIMIT_MAX = process.env.APPLICATION_RATE_LIMIT_MAX || String(TOTAL_APPLICANTS + 50);

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

  // Idempotency lookup: existing `applications` rows keyed by personalEmail. A direct read (not
  // through the API) — reads don't need to prove anything, only the creates below do.
  const existingApplications = await all('SELECT * FROM applications');
  const byPersonalEmail = new Map(existingApplications.map(a => [a.personalEmail, a]));

  const created = [];
  const resumed = [];
  const skipped = [];
  const failed = [];
  const perSemesterCreated = Object.fromEntries(SEMESTER_COUNTS.map((_, i) => [i + 1, 0]));

  for (let n = 1; n <= TOTAL_APPLICANTS; n++) {
    const semester = semesterFor(n);
    const applicant = applicantFor(n);
    const existing = byPersonalEmail.get(applicant.personalEmail);

    try {
      if (existing && existing.status === 'Accepted') {
        skipped.push({ n, name: applicant.fullName, email: applicant.personalEmail, reason: 'already exists (Accepted)' });
        continue;
      }

      let applicationId;
      if (existing) {
        // A previous run submitted this application but the process stopped before approving it
        // — resume from there instead of submitting a second application for the same person.
        applicationId = existing.id;
        resumed.push(applicant.fullName);
      } else {
        const submitRes = await api(null, 'POST', '/applications', {
          fullName: applicant.fullName,
          fatherName: applicant.fatherName,
          grandfatherName: applicant.grandfatherName,
          gender: applicant.gender,
          dateOfBirth: applicant.dateOfBirth,
          nationality: applicant.nationality,
          presentAddress: applicant.presentAddress,
          permanentAddress: applicant.permanentAddress,
          mobileNumber: applicant.mobileNumber,
          emergencyContact: applicant.emergencyContact,
          personalEmail: applicant.personalEmail,
          previousSchoolName: applicant.previousSchoolName,
          previousGraduationYear: applicant.previousGraduationYear,
          desiredDepartmentId: csDept.id,
          entryTestMarks: applicant.entryTestMarks,
        });
        applicationId = submitRes.id;
      }

      const approveRes = await api(adminToken, 'POST', `/applications/${applicationId}/approve`, {
        departmentId: csDept.id,
        programSemester: semester,
      });

      if (csProgram) {
        await api(adminToken, 'PUT', `/student-profile/${approveRes.student.id}`, { specialization: csProgram.name });
      }

      created.push({
        idNumber: approveRes.student.idNumber,
        name: approveRes.student.name,
        email: approveRes.student.email,
        tempPassword: approveRes.tempPassword,
        semester,
      });
      perSemesterCreated[semester]++;
    } catch (err) {
      failed.push({ n, name: applicant.fullName, email: applicant.personalEmail, reason: err.message });
    }
  }

  server.close();

  // --- Credentials for newly-created accounts only — a re-run reporting "skipped" for someone
  // never had their (already-known-to-be-lost) temp password to write out anyway. ---
  let csvPath = null;
  if (created.length) {
    csvPath = path.join(__dirname, '..', 'seed-cs-applicants-credentials.csv');
    const lines = ['idNumber,name,email,tempPassword,semester', ...created.map(s =>
      `${s.idNumber},"${s.name}",${s.email},${s.tempPassword},${s.semester}`)];
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
  }

  console.log('\n================ CS APPLICANT SEED SUMMARY ================');
  console.log(`Target: ${TOTAL_APPLICANTS} applicants across ${SEMESTER_COUNTS.length} semesters (${SEMESTER_COUNTS.join(', ')}).`);
  console.log(`Created this run:   ${created.length}`);
  if (resumed.length) console.log(`  (of which ${resumed.length} resumed a previously-submitted-but-not-approved application)`);
  console.log(`Already existed:    ${skipped.length}`);
  console.log(`Failed:             ${failed.length}`);
  console.log('\nCreated per semester:');
  for (const [sem, count] of Object.entries(perSemesterCreated)) console.log(`  Semester ${sem}: ${count}`);
  if (skipped.length) {
    console.log('\nSkipped (already existed):');
    for (const s of skipped) console.log(`  - ${s.name} <${s.email}>`);
  }
  if (failed.length) {
    console.log('\nFailed:');
    for (const f of failed) console.log(`  - #${f.n} ${f.name} <${f.email}>: ${f.reason}`);
  }
  if (csvPath) console.log(`\nCredentials for ${created.length} new account(s) written to:\n  ${csvPath}`);
  console.log('==============================================================\n');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
