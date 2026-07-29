const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { idPrefixFor, nextSequenceNumber, formatIdNumber } = require('./idNumbers');

// Loads a local .env file if one exists (Node's built-in loader — no dotenv
// dependency needed).
try { process.loadEnvFile(); } catch { /* no .env file present — fine */ }

// Defaults to a file under this package so the app works out of the box.
// Override with DB_PATH (e.g. a user-writable app-data directory once this
// is packaged as a desktop app, or ':memory:' for tests).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'database.sqlite');

if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

// `let`, not `const` — restoreFrom() swaps the handle for a fresh one after
// replacing the file. Nothing outside this module holds the raw handle
// (every caller goes through run/get/all), so reassignment is safe.
let db = openDb();

function openDb() {
  const handle = new DatabaseSync(DB_PATH);
  handle.exec('PRAGMA foreign_keys = ON');
  return handle;
}

// db.prepare().run/get/all() are synchronous, but every call site in this
// app already calls run/get/all with `await` — keeping these declared as
// `async` costs nothing (awaiting a non-Promise just resolves immediately)
// and means no caller needs to change if the backing store ever changes again.
async function run(sql, params = []) {
  const result = db.prepare(sql).run(...params);
  return { id: Number(result.lastInsertRowid), changes: Number(result.changes) };
}
async function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
async function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

async function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      passwordHash TEXT,
      role TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS colleges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      startDate TEXT,
      endDate TEXT,
      isActive INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      departmentId INTEGER REFERENCES departments(id),
      userId INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      capacity INTEGER,
      equipment TEXT
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      departmentId INTEGER REFERENCES departments(id),
      credits INTEGER,
      teacherId INTEGER REFERENCES teachers(id),
      roomId INTEGER REFERENCES rooms(id),
      maxStudents INTEGER,
      termId INTEGER REFERENCES terms(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_code_term ON courses(code, termId);

    CREATE TABLE IF NOT EXISTS course_prerequisites (
      courseId INTEGER REFERENCES courses(id),
      prerequisiteCourseId INTEGER REFERENCES courses(id),
      PRIMARY KEY (courseId, prerequisiteCourseId)
    );

    CREATE TABLE IF NOT EXISTS timetable_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER REFERENCES courses(id),
      day TEXT NOT NULL,
      time TEXT NOT NULL,
      durationMinutes INTEGER DEFAULT 60,
      roomId INTEGER REFERENCES rooms(id),
      termId INTEGER REFERENCES terms(id)
    );

    -- One-off deviations from a slot's weekly recurrence: a single dated
    -- occurrence either cancelled or moved to a new date/time/room. The slot
    -- row itself is never touched, so the regular schedule stays intact.
    CREATE TABLE IF NOT EXISTS slot_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slotId INTEGER NOT NULL REFERENCES timetable_slots(id) ON DELETE CASCADE,
      date TEXT NOT NULL,            -- the affected occurrence (YYYY-MM-DD)
      kind TEXT NOT NULL,            -- 'cancelled' | 'rescheduled'
      newDate TEXT,                  -- rescheduled only: where the session moves
      newTime TEXT,
      newRoomId INTEGER REFERENCES rooms(id),
      newDurationMinutes INTEGER,
      note TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(slotId, date)
    );

    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER REFERENCES courses(id),
      date TEXT,
      time TEXT,
      durationMinutes INTEGER DEFAULT 120,
      roomId INTEGER REFERENCES rooms(id),
      invigilatorId INTEGER REFERENCES teachers(id),
      termId INTEGER REFERENCES terms(id)
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER REFERENCES users(id),
      courseId INTEGER REFERENCES courses(id),
      status TEXT DEFAULT 'enrolled',
      grade TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- One row per (session, student): present/absent/late for a specific class
    -- meeting date — never a general per-course flag. slotId identifies which
    -- weekly meeting the session belongs to; courseId is denormalized from it
    -- purely so course-wide history/queries don't need a join through slots.
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slotId INTEGER NOT NULL REFERENCES timetable_slots(id) ON DELETE CASCADE,
      courseId INTEGER NOT NULL REFERENCES courses(id),
      studentId INTEGER NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      markedBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(slotId, studentId, date)
    );

    -- Per-user notices that need to survive to a later login (unlike toasts, which
    -- only exist for the person who triggered them in that same session). Currently
    -- only populated when a class is cancelled, to alert its instructor.
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      isRead INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- White-label branding: org display name, brand color, and whether a custom logo has
    -- been uploaded (the logo image itself lives on disk next to the database, not here —
    -- see routes/settings.js). A simple key-value table rather than dedicated columns since
    -- this is the only place app-wide (non-per-entity) configuration lives so far.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- A gradebook "column" for a course — an assignment, quiz, midterm, exam, or final —
    -- worth maxScore points. Feeds enrollments.grade (the single holistic A-F letter grade,
    -- still used for prerequisite checks and the roster view): once every item here has a
    -- score for a student, gradingScale.js auto-computes and writes that letter grade back —
    -- it's never entered by hand, and stays in sync any time a score, item, or the
    -- system-wide grading scale (see the 'gradingScale' settings row) changes.
    CREATE TABLE IF NOT EXISTS grade_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'assignment',
      maxScore REAL NOT NULL DEFAULT 100,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- One student's score on one grade item. NULL score means "not graded yet" (distinct
    -- from a row not existing at all — both render the same, but this shape keeps the
    -- upsert in routes/grades.js simple: always one row per (item, student) once touched).
    CREATE TABLE IF NOT EXISTS grade_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gradeItemId INTEGER NOT NULL REFERENCES grade_items(id) ON DELETE CASCADE,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score REAL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gradeItemId, studentId)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      userName TEXT,
      action TEXT NOT NULL,
      entityType TEXT NOT NULL,
      entityId INTEGER,
      details TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Faculty course quick-actions: assignments posted for a course, visible to every
    -- enrolled student (see routes/assignments.js).
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      dueDate TEXT,
      maxMarks INTEGER,
      createdBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- One student's submission for one assignment — a file, a text response, or both.
    -- UNIQUE(assignmentId, studentId) means a resubmission is an upsert, not a new row.
    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fileName TEXT,
      fileMimeType TEXT,
      textResponse TEXT,
      marksAwarded REAL,
      feedback TEXT,
      submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(assignmentId, studentId)
    );

    -- A faculty text notice for a course (e.g. "Class moved to Lab 2 tomorrow"),
    -- separate from graded assignments.
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      createdBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Per-student "last time they opened this course's activity card" — deliberately separate
    -- from notifications.isRead, since opening the bell already mark-all-reads every notification
    -- and would otherwise clear a course badge the student never actually looked at.
    CREATE TABLE IF NOT EXISTS course_activity_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      courseId INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      lastViewedAt DATETIME NOT NULL,
      UNIQUE(studentId, courseId)
    );

    -- A single downloadable file a faculty member posts for a course (lecture slides, a
    -- reading, etc.), visible to every enrolled student.
    CREATE TABLE IF NOT EXISTS course_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      fileName TEXT NOT NULL,
      fileMimeType TEXT,
      createdBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- One row per student, lazily created on first profile access (see routes/studentProfile.js).
    -- programSemester/section are deliberately their own fields here, not derived from
    -- timetable_slots — a student's own current standing, not a per-course value.
    CREATE TABLE IF NOT EXISTS student_profiles (
      studentId INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      fatherName TEXT,
      grandfatherName TEXT,
      gender TEXT,
      dateOfBirth TEXT,
      nationality TEXT,
      nationalId TEXT,
      passportNumber TEXT,
      presentAddress TEXT,
      permanentAddress TEXT,
      mobileNumber TEXT,
      emergencyContact TEXT,
      entryTestMarks REAL,
      sponsor TEXT,
      specialization TEXT,
      advisorTeacherId INTEGER REFERENCES teachers(id),
      departmentId INTEGER REFERENCES departments(id),
      programSemester INTEGER,
      section TEXT,
      admissionStatus TEXT DEFAULT 'Approved',
      enrollmentStatus TEXT DEFAULT 'Regular',
      previousSchoolName TEXT,
      previousGraduationYear INTEGER,
      updatedAt DATETIME
    );

    -- Official documents (ID scans, certificates, etc.) admin uploads on a student's behalf.
    CREATE TABLE IF NOT EXISTS student_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      documentType TEXT NOT NULL,
      title TEXT NOT NULL,
      fileName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      uploadedBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- A prospective student's application, before any users row exists for them. Field names
    -- deliberately mirror student_profiles 1:1 so approval (see routes/applications.js) is a
    -- straight copy, not a remap. status: Submitted | Under Review | Entry Test Scheduled |
    -- Waitlisted | Accepted | Rejected. source: public | admin.
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullName TEXT NOT NULL,
      fatherName TEXT,
      grandfatherName TEXT,
      gender TEXT,
      dateOfBirth TEXT,
      nationality TEXT,
      nationalId TEXT,
      passportNumber TEXT,
      presentAddress TEXT,
      permanentAddress TEXT,
      mobileNumber TEXT,
      emergencyContact TEXT,
      personalEmail TEXT NOT NULL,
      previousSchoolName TEXT,
      previousGraduationYear INTEGER,
      desiredDepartmentId INTEGER REFERENCES departments(id),
      entryTestMarks REAL,
      status TEXT NOT NULL DEFAULT 'Submitted',
      decisionNote TEXT,
      decidedBy INTEGER REFERENCES users(id),
      decidedAt DATETIME,
      createdStudentId INTEGER REFERENCES users(id),
      source TEXT NOT NULL DEFAULT 'public',
      createdBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME
    );

    -- Supporting documents attached to an application (before a student account exists).
    -- Approval copies these into student_documents — see routes/applications.js.
    CREATE TABLE IF NOT EXISTS application_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applicationId INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      documentType TEXT NOT NULL,
      title TEXT NOT NULL,
      fileName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      uploadedBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Finance: fees are charged per credit (rate lives in settings as
    -- 'perCreditFee'); a student's total charge is derived live from their
    -- enrolled courses' credits. Payments are recorded here as installments,
    -- each its own receipt. Balance = total charged - sum(payments.amount).
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id),
      amount REAL NOT NULL,
      method TEXT,
      reference TEXT,
      note TEXT,
      receiptNo TEXT,
      paidAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdBy INTEGER REFERENCES users(id)
    );
  `);

  ensureColumn('timetable_slots', 'durationMinutes', 'INTEGER DEFAULT 60');
  ensureColumn('exams', 'durationMinutes', 'INTEGER DEFAULT 120');
  // 'quiz' | 'midterm' | 'final' — defaults to 'final' since that's what every exam
  // scheduled before this column existed actually was.
  ensureColumn('exams', 'type', "TEXT DEFAULT 'final'");
  ensureColumn('enrollments', 'grade', 'TEXT');
  ensureColumn('users', 'mustChangePassword', 'INTEGER DEFAULT 0');
  // Per-user UI language ('en' | 'ps' | 'prs') — each account keeps its own preference,
  // not a single app-wide setting, so an admin and a student can each read the app in
  // whichever language they prefer.
  ensureColumn('users', 'language', "TEXT DEFAULT 'en'");
  // Department a department-scoped staff role (e.g. Department Head) is confined
  // to — enforced on the backend via scope.js. NULL for unscoped roles (Super
  // Admin, Registrar, Admissions Officer, students; faculty carry their
  // department on the teachers row instead, though it's mirrored here too).
  ensureColumn('users', 'departmentId', 'INTEGER');
  // College a college-scoped role (Dean) is confined to. A Dean's scope resolves
  // to every department whose collegeId matches — the multi-department analogue
  // of a Department Head's single departmentId above. NULL for everyone else.
  ensureColumn('users', 'collegeId', 'INTEGER');
  // Which college a department belongs to (Deans are scoped by this). NULL until
  // an admin groups the department under a college — colleges are an optional
  // organizational layer, so departments work fine ungrouped.
  ensureColumn('departments', 'collegeId', 'INTEGER');
  ensureColumn('timetable_slots', 'programSemester', 'INTEGER');
  ensureColumn('timetable_slots', 'section', 'TEXT');
  ensureColumn('terms', 'offDays', "TEXT DEFAULT '[]'");
  // Global per-semester cap on total enrolled credits per student — NULL means no limit.
  // Deliberately a single term-wide default rather than a per-student override: this app has
  // no existing concept of academic standing/probation that would justify per-student exceptions.
  ensureColumn('terms', 'creditLimit', 'INTEGER');
  // Optional finals-week window, distinct from the semester's own startDate/endDate — lets an
  // admin pin down exactly where exams should land. When unset, candidateDates() (dateUtils.js)
  // falls back to the last two weeks of the semester as a reasonable default.
  ensureColumn('terms', 'examStartDate', 'TEXT');
  ensureColumn('terms', 'examEndDate', 'TEXT');

  // Student ID / Faculty ID (see idNumbers.js for the format). A plain unique
  // index — not a UNIQUE column constraint — because ALTER TABLE ADD COLUMN
  // can't add one directly, and this needs to tolerate the NULLs that exist
  // between adding the column and backfillIdNumbers() finishing below.
  ensureColumn('users', 'idNumber', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_idnumber ON users(idNumber)');
  await backfillIdNumbers();

  // Lets a notification carry enough context (what kind, which course/entity) for the
  // course quick-actions feature's per-course "unviewed" badge — the base columns above
  // stay untouched, so the existing cancellation-notice code needs no changes.
  ensureColumn('notifications', 'type', 'TEXT');
  ensureColumn('notifications', 'courseId', 'INTEGER');
  ensureColumn('notifications', 'entityType', 'TEXT');
  ensureColumn('notifications', 'entityId', 'INTEGER');
}

/** The single source of truth for assigning an ID number to a user — used both when a new
    account is created (accounts.js, seed.js, the Electron app's first-run admin) and by the
    retroactive backfill just below. Always queries current usage rather than caching a
    counter, so it stays correct across every one of those call sites. */
async function nextIdNumberForRole(role, year = new Date().getFullYear()) {
  const prefix = idPrefixFor(role, year);
  const existing = (await all('SELECT idNumber FROM users WHERE idNumber LIKE ?', [prefix + '%'])).map(r => r.idNumber);
  return formatIdNumber(role, year, nextSequenceNumber(prefix, existing));
}

/** Assigns an ID number to any user who doesn't already have one (existing test data, accounts
    seeded before this feature existed, or a backup restored from an older version) — runs on
    every startup, so nobody stays without an ID for more than one restart. Processed in id
    (creation) order, using each account's own createdAt year, so backfilled IDs still read as a
    plausible cohort/hire year rather than all landing in whatever year the backfill happened to run. */
async function backfillIdNumbers() {
  const missing = await all('SELECT id, role, createdAt FROM users WHERE idNumber IS NULL ORDER BY id');
  for (const u of missing) {
    const year = new Date(u.createdAt + 'Z').getFullYear();
    const idNumber = await nextIdNumberForRole(u.role, year);
    await run('UPDATE users SET idNumber = ? WHERE id = ?', [idNumber, u.id]);
  }
}

/** Adds a column to an existing table if it isn't already there — safe to call on every startup. */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Case-insensitive lookup — account creation stores emails lowercased, but older rows (and how people type their own address) may not be, so login and duplicate-checks must not be case-sensitive. */
function findUserByEmail(email) {
  return get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);
}

async function createUser({ name, email, passwordHash, role = 'student' }) {
  const result = await run(
    'INSERT INTO users (name, email, passwordHash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, role]
  );
  return { id: result.id, name, email, role };
}

/** Records an admin/faculty action for the audit log. `user` is the JWT payload (req.user): { sub, email, role }. Never throws — a logging failure must not break the underlying request. */
async function logAudit(user, action, entityType, entityId, details) {
  try {
    await run(
      'INSERT INTO audit_log (userId, userName, action, entityType, entityId, details) VALUES (?, ?, ?, ?, ?, ?)',
      [user?.sub ?? null, user?.email ?? 'Unknown', action, entityType, entityId ?? null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('Failed to write audit log entry:', err.message);
  }
}

/** Writes a consistent snapshot of the live database to destPath. VACUUM INTO is
    safe to run while the app is serving requests and produces a compact, fully
    self-contained copy. destPath must not already exist (SQLite refuses otherwise). */
async function backupTo(destPath) {
  db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
}

/** Replaces the live database with the (already validated) SQLite file at srcPath.
    The current data is kept at <DB_PATH>.pre-restore as a safety net. Reopens the
    connection and re-runs init() so a backup taken by an older app version gets
    any since-added columns before the next query hits it. */
async function restoreFrom(srcPath) {
  if (DB_PATH === ':memory:') throw new Error('Cannot restore an in-memory database');
  db.close();
  try {
    fs.copyFileSync(DB_PATH, DB_PATH + '.pre-restore');
    fs.copyFileSync(srcPath, DB_PATH);
  } finally {
    db = openDb();
  }
  await init();
}

module.exports = { run, get, all, init, findUserByEmail, createUser, logAudit, backupTo, restoreFrom, DB_PATH, nextIdNumberForRole };
