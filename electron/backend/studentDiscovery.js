const { all, run } = require('./db');

const SOURCE_QUERIES = {
  finance: `SELECT studentId AS id FROM payments
            UNION SELECT studentId FROM finance_transactions
            UNION SELECT studentId FROM finance_charge_lines
            UNION SELECT studentId FROM installments
            UNION SELECT studentId FROM student_financial_aid`,
  enrollment: `SELECT DISTINCT studentId AS id FROM enrollments WHERE studentId IS NOT NULL`,
  attendance: `SELECT DISTINCT studentId AS id FROM attendance`,
  gradebook: `SELECT DISTINCT studentId AS id FROM grade_scores`,
  application: `SELECT DISTINCT createdStudentId AS id FROM applications WHERE createdStudentId IS NOT NULL`,
};

/** Guarantees a student_profiles row for every role='student' user — same statement as the
    startup backfill in db.js, re-run here so the Students page self-heals on every load rather
    than only trusting server-boot state. Naturally idempotent: the WHERE NOT IN already excludes
    rows that exist, so a repeat call finds nothing to insert. */
async function backfillMissingProfiles() {
  await run(`
    INSERT INTO student_profiles (studentId, enrollmentDate)
    SELECT id, DATE(createdAt) FROM users
    WHERE role = 'student' AND id NOT IN (SELECT studentId FROM student_profiles)
  `);
}

/** Scans every module that references a student by id (finance, enrollment, attendance,
    gradebook, admissions) plus unresolved accepted applications, and reconciles what it finds
    against the users table. Returns only the entries that AREN'T already plain role='student'
    users — i.e. the gaps: a student-shaped record whose account's role has since changed
    ('role_mismatch'), a student-shaped studentId with no user account at all ('unlinked_user' —
    expected to never occur given this schema's enforced foreign keys, but not assumed), and an
    accepted application with no linked account ('no_account'). */
async function discoverFlaggedStudents() {
  const users = await all(`SELECT id, name, email, idNumber, role FROM users`);
  const usersById = new Map(users.map(u => [u.id, u]));
  const usersByEmail = new Map(
    users.filter(u => u.email).map(u => [u.email.toLowerCase(), u])
  );

  const sourcesById = new Map();
  const addSource = (id, source) => {
    if (id == null) return;
    if (!sourcesById.has(id)) sourcesById.set(id, new Set());
    sourcesById.get(id).add(source);
  };
  for (const u of users) {
    if (u.role === 'student') addSource(u.id, 'account');
  }
  for (const [source, sql] of Object.entries(SOURCE_QUERIES)) {
    const rows = await all(sql);
    for (const r of rows) addSource(r.id, source);
  }

  const flagged = [];
  const consumedIds = new Set();
  for (const [id, sources] of sourcesById) {
    const user = usersById.get(id);
    if (user && user.role === 'student') continue; // already a normal row, nothing to flag
    consumedIds.add(id);
    if (user) {
      flagged.push({
        kind: 'role_mismatch',
        id: user.id,
        name: user.name,
        email: user.email,
        idNumber: user.idNumber,
        role: user.role,
        sources: [...sources],
      });
    } else {
      flagged.push({
        kind: 'unlinked_user',
        id,
        name: null,
        email: null,
        idNumber: null,
        role: null,
        sources: [...sources],
      });
    }
  }

  const unresolvedApps = await all(
    `SELECT id, fullName, personalEmail, desiredDepartmentId, decidedAt, createdAt
     FROM applications WHERE createdStudentId IS NULL AND status = 'Accepted'`
  );
  for (const app of unresolvedApps) {
    const matchedUser = usersByEmail.get(String(app.personalEmail || '').toLowerCase());
    if (matchedUser) {
      if (consumedIds.has(matchedUser.id) || matchedUser.role === 'student') continue; // already represented, dedup
      flagged.push({
        kind: 'role_mismatch',
        id: matchedUser.id,
        name: matchedUser.name,
        email: matchedUser.email,
        idNumber: matchedUser.idNumber,
        role: matchedUser.role,
        sources: ['application'],
      });
      consumedIds.add(matchedUser.id);
    } else {
      flagged.push({
        kind: 'no_account',
        id: null,
        applicationId: app.id,
        name: app.fullName,
        email: app.personalEmail,
        desiredDepartmentId: app.desiredDepartmentId,
        decidedAt: app.decidedAt,
        sources: ['application'],
      });
    }
  }

  return flagged;
}

async function discoverStudents() {
  await backfillMissingProfiles();
  const flagged = await discoverFlaggedStudents();
  return { flagged };
}

module.exports = { discoverStudents };
