const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { idPrefixFor, nextSequenceNumber, formatIdNumber } = require('./idNumbers');
const { MODULES, ROLES, levelFor, NONE, WRITE } = require('./permissions');

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
  // One-time safety net: if this is an existing database being upgraded to add the new Finance
  // ledger tables (added below), snapshot it first. Skipped for a brand-new database (no 'users'
  // table yet) and skipped again on every later restart once finance_transactions exists.
  if (DB_PATH !== ':memory:') {
    const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    const hasFinanceLedger = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='finance_transactions'").get();
    if (hasUsers && !hasFinanceLedger) {
      const backupDir = path.join(path.dirname(DB_PATH), 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await backupTo(path.join(backupDir, `pre-finance-migration-${stamp}.sqlite`));
    }
    // Same one-time-snapshot rationale as the finance migration above, ahead of the canonical
    // student-profile backfill below (adds student_profiles.applicationId/enrollmentDate and
    // creates any missing profile rows).
    const hasStudentProfiles = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='student_profiles'").get();
    const hasApplicationIdCol = hasStudentProfiles
      && db.prepare("PRAGMA table_info(student_profiles)").all().some(c => c.name === 'applicationId');
    if (hasUsers && hasStudentProfiles && !hasApplicationIdCol) {
      const backupDir = path.join(path.dirname(DB_PATH), 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await backupTo(path.join(backupDir, `pre-student-canonical-migration-${stamp}.sqlite`));
    }
  }
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

    -- Configurable student categories (Regular, International, Scholarship, ...) used to
    -- differentiate fee rules/fixed fees by student type. Seeded with a default set on first
    -- run (see seedDefaultStudentTypes below) but fully admin-editable — nothing in the app
    -- hardcodes these names beyond the seed.
    CREATE TABLE IF NOT EXISTS student_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
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

    -- A degree/major track a student pursues within a department (e.g. "BSc Computer
    -- Science"). Wired up via routes/programs.js; a student is linked to one via
    -- student_profiles.programId (see ensureColumn below). specialization on student_profiles
    -- remains as free-text display fallback for students not yet assigned a real program.
    CREATE TABLE IF NOT EXISTS programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      departmentId INTEGER REFERENCES departments(id),
      degreeLevel TEXT,
      totalCredits INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_programs_departmentId ON programs(departmentId);

    -- A student's academic record for one attempt at one semester number — the historical ledger
    -- automatic progression (academicProgression.js) reads and writes. Never overwritten once
    -- completedAt is set: a repeated/failed semester gets a brand-new row (same studentId +
    -- semesterNumber can appear more than once), so the full attempt history survives. Exactly one
    -- row per student is ever "open" (status IN 'In Progress'/'Awaiting Results'/'On Hold') at a
    -- time — that row is what student_profiles.programSemester/semesterStatus mirror for fast reads.
    CREATE TABLE IF NOT EXISTS semester_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      semesterNumber INTEGER NOT NULL,
      termId INTEGER REFERENCES terms(id),
      status TEXT NOT NULL DEFAULT 'In Progress',
      creditsAttempted REAL DEFAULT 0,
      creditsEarned REAL DEFAULT 0,
      termGpa REAL,
      cgpa REAL,
      failedCourses TEXT,
      notes TEXT,
      createdBy INTEGER REFERENCES users(id),
      startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      completedAt DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_semester_records_studentId ON semester_records(studentId);
    CREATE INDEX IF NOT EXISTS idx_semester_records_termId ON semester_records(termId);

    -- One term's specific binding of a course to a teacher/room/section/cap, kept
    -- alongside (not instead of) the same fields on courses — courses.teacherId etc.
    -- remain the ones every existing page/API actually reads. This table exists so a
    -- future phase can support multiple sections of one course per term without
    -- touching anything that depends on the current courses columns.
    CREATE TABLE IF NOT EXISTS course_offerings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL REFERENCES courses(id),
      termId INTEGER REFERENCES terms(id),
      section TEXT,
      teacherId INTEGER REFERENCES teachers(id),
      roomId INTEGER REFERENCES rooms(id),
      maxStudents INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_course_offerings_courseId ON course_offerings(courseId);
    CREATE INDEX IF NOT EXISTS idx_course_offerings_termId ON course_offerings(termId);
    CREATE INDEX IF NOT EXISTS idx_course_offerings_teacherId ON course_offerings(teacherId);

    -- A discount/scholarship record for a student. Schema only: nothing in
    -- finance.js reads this yet, so it has no effect on balances until a later,
    -- separately-reviewed phase wires it into the fee calculation.
    CREATE TABLE IF NOT EXISTS scholarships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'fixed',
      amount REAL NOT NULL,
      termId INTEGER REFERENCES terms(id),
      note TEXT,
      createdBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_scholarships_studentId ON scholarships(studentId);

    -- Per-term fee configuration: fee-per-credit rate and currency, one row per term. Replaces
    -- the old single global settings.perCreditFee/currency for tuition calculation going forward
    -- (that key is left untouched as a fallback default for any term with no row here yet, so
    -- pre-existing configuration isn't lost — see finance.js getTermFeeConfig()).
    CREATE TABLE IF NOT EXISTS term_fee_config (
      termId INTEGER PRIMARY KEY REFERENCES terms(id),
      feePerCredit REAL NOT NULL DEFAULT 0,
      currency TEXT,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedBy INTEGER REFERENCES users(id)
    );

    -- Optional fixed fees for a term (admission, library, lab, etc.), added on top of the
    -- per-credit tuition when charges are generated. appliesTo: 'all' every registered student;
    -- 'dept' only students whose student_profiles.departmentId matches appliesToId; 'program' is
    -- accepted for forward compatibility but not yet appliable — there is no student-to-program
    -- assignment anywhere in the app yet (see the programs table above).
    CREATE TABLE IF NOT EXISTS fee_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      termId INTEGER NOT NULL REFERENCES terms(id),
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      appliesTo TEXT NOT NULL DEFAULT 'all',
      appliesToId INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdBy INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_fee_items_termId ON fee_items(termId);

    -- Hierarchical tuition rate rules: one fee-per-credit figure per (term, scope, student
    -- type), where scope narrows to university/college/department/program. scopeId is 0 for
    -- 'university' (no narrower id needed), otherwise a colleges/departments/programs id.
    -- studentTypeId is 0 to mean "every student type" at that scope. The unique index blocks
    -- two active rules from ever describing the exact same scope, so resolution (see
    -- resolveFeeRule in finance.js) is never ambiguous — it walks from most to least specific
    -- and takes the first row that exists, falling back to legacy term_fee_config/settings
    -- (the "University Default") when no fee_rules row matches at all.
    CREATE TABLE IF NOT EXISTS fee_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      termId INTEGER NOT NULL REFERENCES terms(id),
      scope TEXT NOT NULL,
      scopeId INTEGER NOT NULL DEFAULT 0,
      studentTypeId INTEGER NOT NULL DEFAULT 0,
      feePerCredit REAL NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      effectiveDate TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdBy INTEGER REFERENCES users(id),
      updatedAt DATETIME,
      updatedBy INTEGER REFERENCES users(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_rules_scope_unique ON fee_rules(termId, scope, scopeId, studentTypeId);
    CREATE INDEX IF NOT EXISTS idx_fee_rules_term ON fee_rules(termId);

    -- The ledger: every financial event for a student, source of truth for balances. type:
    -- 'charge' | 'payment' | 'adjustment' | 'refund' | 'aid'. amount is a positive magnitude for
    -- charge/payment/aid/refund; only 'adjustment' may be negative (an explicit signed manual
    -- correction). Balance = charge + refund + adjustment - payment - aid (see finance.js
    -- computeTotals()). relatedPaymentId/relatedAidId trace back to the payments/
    -- student_financial_aid row that produced this entry, so voiding one can find and reverse the
    -- other without a second lookup table.
    CREATE TABLE IF NOT EXISTS finance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id),
      termId INTEGER REFERENCES terms(id),
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT,
      reference TEXT,
      description TEXT,
      relatedPaymentId INTEGER REFERENCES payments(id),
      relatedAidId INTEGER REFERENCES student_financial_aid(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdBy INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_finance_transactions_student ON finance_transactions(studentId, termId);
    -- One live 'charge' row per student per term — generate-charges upserts into it instead of
    -- inserting a fresh row every run, which is what makes re-running idempotent.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_transactions_charge_unique ON finance_transactions(studentId, termId) WHERE type = 'charge';

    -- The itemized breakdown behind a generated charge (one row per course line or fee item),
    -- snapshotted at generate-charges time so the statement panel always shows exactly what was
    -- charged even if a course's credits or the term's rate change afterward. Regenerated (old
    -- rows deleted, fresh ones inserted) every time charges are (re)generated for that student/term.
    CREATE TABLE IF NOT EXISTS finance_charge_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id),
      termId INTEGER NOT NULL REFERENCES terms(id),
      kind TEXT NOT NULL,
      refId INTEGER,
      label TEXT NOT NULL,
      quantity REAL,
      rate REAL,
      amount REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_finance_charge_lines_student ON finance_charge_lines(studentId, termId);

    -- A term's installment template: how many installments, and each one's due date and/or
    -- percentage of the student's net payable. Applied per-student when charges are generated to
    -- produce their actual installments rows below. percentage nullable — when every row in a
    -- plan leaves it blank, generate-charges splits net payable evenly across installmentCount.
    CREATE TABLE IF NOT EXISTS fee_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      termId INTEGER NOT NULL UNIQUE REFERENCES terms(id),
      installmentCount INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_plan_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feePlanId INTEGER NOT NULL REFERENCES fee_plans(id) ON DELETE CASCADE,
      installmentNo INTEGER NOT NULL,
      dueDate TEXT,
      percentage REAL,
      UNIQUE(feePlanId, installmentNo)
    );

    -- A student's actual installment schedule for a term, generated from that term's fee_plan (or
    -- a single lump-sum installment if no plan is configured) when charges are generated.
    -- paidAmount tracks running allocation from payments; status is recomputed and persisted on
    -- every allocation/void/aid recompute (see finance.js) and re-derived for display if its due
    -- date has since passed (overdue is time-sensitive, so a read can surface it without a write).
    CREATE TABLE IF NOT EXISTS installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id),
      termId INTEGER NOT NULL REFERENCES terms(id),
      installmentNo INTEGER NOT NULL,
      amount REAL NOT NULL,
      dueDate TEXT,
      paidAmount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(studentId, termId, installmentNo)
    );
    CREATE INDEX IF NOT EXISTS idx_installments_student ON installments(studentId, termId);

    -- A scholarship/grant/waiver/discount award. Distinct from (and unrelated to) the legacy
    -- scholarships table above, which nothing in the UI has ever surfaced — this is the aid model
    -- the Finance module actually uses. basis: 'percentage' (of tuition only, not fixed fees) or
    -- 'fixed'. status: 'active' | 'revoked' — revoking flips status and reverses the matching
    -- 'aid' finance_transactions entry rather than deleting the award, preserving the historical
    -- record of who awarded and later revoked it.
    CREATE TABLE IF NOT EXISTS student_financial_aid (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id),
      termId INTEGER NOT NULL REFERENCES terms(id),
      type TEXT NOT NULL,
      basis TEXT NOT NULL,
      value REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      awardedBy INTEGER REFERENCES users(id),
      reason TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_student_financial_aid_student ON student_financial_aid(studentId, termId);

    -- Faculty HR profile: personal/employment details kept separate from teachers, which stays
    -- purely the scheduling-facing record (name/department/login link) every course/exam/slot FK
    -- already points at. 1:1 via teacherId as its own primary key (mirrors student_profiles'
    -- studentId-as-PK pattern) — no column is added to teachers itself. Lazily created on first
    -- profile access, same as student_profiles (see routes/teacherProfile.js).
    CREATE TABLE IF NOT EXISTS teacher_profiles (
      teacherId INTEGER PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
      gender TEXT,
      dateOfBirth TEXT,
      phone TEXT,
      personalEmail TEXT,
      address TEXT,
      photoPath TEXT,
      designation TEXT,
      employmentType TEXT,
      dateOfJoining TEXT,
      status TEXT DEFAULT 'Active',
      bio TEXT,
      qualifiedSubjects TEXT,
      updatedAt DATETIME
    );

    -- A teacher's degrees/qualifications, oldest to newest. Each row may carry its own scanned
    -- certificate (documentPath, disk-backed — see facultyStorage.js), independent of the general
    -- teacher_documents below.
    CREATE TABLE IF NOT EXISTS teacher_education (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacherId INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      degree TEXT NOT NULL,
      fieldOfStudy TEXT,
      institution TEXT,
      year INTEGER,
      documentPath TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_education_teacherId ON teacher_education(teacherId);

    -- General faculty documents (CV, contract, other certificates) not tied to a specific
    -- education row. Mirrors student_documents: metadata here, bytes on disk.
    CREATE TABLE IF NOT EXISTS teacher_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacherId INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      docType TEXT NOT NULL,
      filePath TEXT NOT NULL,
      fileName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      uploadedBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_documents_teacherId ON teacher_documents(teacherId);

    -- A teacher's prior employment history, oldest to newest — separate from teacher_education
    -- (degrees) and teacher_documents (loose files). Mirrors teacher_education's shape: metadata
    -- here, an optional scanned experience certificate on disk via facultyStorage.js.
    CREATE TABLE IF NOT EXISTS teacher_experience (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacherId INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      organization TEXT NOT NULL,
      position TEXT,
      department TEXT,
      employmentType TEXT,
      startDate TEXT,
      endDate TEXT,
      currentlyWorking INTEGER NOT NULL DEFAULT 0,
      responsibilities TEXT,
      documentPath TEXT,
      verificationStatus TEXT NOT NULL DEFAULT 'Pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_experience_teacherId ON teacher_experience(teacherId);

    -- Professional certifications/licenses, independent of academic degrees (teacher_education).
    CREATE TABLE IF NOT EXISTS teacher_certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacherId INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      issuingOrganization TEXT,
      certificationNumber TEXT,
      issueDate TEXT,
      expiryDate TEXT,
      doesNotExpire INTEGER NOT NULL DEFAULT 0,
      documentPath TEXT,
      verificationStatus TEXT NOT NULL DEFAULT 'Pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_certifications_teacherId ON teacher_certifications(teacherId);

    -- Granular Module.Action permissions (e.g. "Courses.Update"), seeded from the existing
    -- module-level POLICY in permissions.js (see seedAuthzTables() below) so day-one access is
    -- identical to today — nothing here changes what a role can do until role_permissions rows
    -- are edited going forward. Coexists with (doesn't replace) the legacy can()/POLICY, which
    -- keeps working for any route not yet migrated to requirePermission('Module.Action').
    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      UNIQUE(module, action)
    );

    -- Which roles hold which permission. A role absent for a permission has no access to it —
    -- same "absence means none" convention as the legacy POLICY object.
    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      permissionId INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      UNIQUE(role, permissionId)
    );
    CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);

    -- Secondary roles a user holds in addition to their one primary users.role (never touched
    -- by this table). Additive: a user with no rows here behaves exactly as today.
    CREATE TABLE IF NOT EXISTS user_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(userId, role)
    );
    CREATE INDEX IF NOT EXISTS idx_user_roles_userId ON user_roles(userId);

    -- Generalized organizational scope attached to a user (scopeType: 'department' | 'college' |
    -- 'course', scopeId: that entity's id). Department Head/Dean scoping already works today via
    -- users.departmentId/collegeId + scope.js, which is left as the source of truth for THAT
    -- check — this table is the additive, general-purpose mechanism for scope kinds that don't
    -- fit those two columns (e.g. a role scoped to a specific course), seeded as a mirror of the
    -- existing department/college columns below so it's populated and inspectable from day one.
    CREATE TABLE IF NOT EXISTS user_scopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scopeType TEXT NOT NULL,
      scopeId INTEGER NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(userId, scopeType, scopeId)
    );
    CREATE INDEX IF NOT EXISTS idx_user_scopes_userId ON user_scopes(userId);

    -- University-wide targeted announcement system. Deliberately a separate entity from the
    -- lightweight per-course 'announcements' table above (which stays exactly as-is, still used
    -- by the faculty course quick-actions feature) — this one has a title, type/priority/status
    -- workflow, scheduling/expiry, and structured multi-audience targeting, none of which the
    -- old table needs. status: draft | scheduled | published | expired | archived | cancelled.
    -- actionSection (optional) is an in-app NavigationContext section name a "view details"
    -- button jumps to — never a raw URL, so a recipient can never be sent somewhere the app
    -- itself wouldn't otherwise route them (the destination page still enforces its own access).
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'general',
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'draft',
      pinned INTEGER NOT NULL DEFAULT 0,
      requiresAck INTEGER NOT NULL DEFAULT 0,
      actionLabel TEXT,
      actionSection TEXT,
      scheduledFor DATETIME,
      publishedAt DATETIME,
      expiresAt DATETIME,
      createdBy INTEGER REFERENCES users(id),
      createdByRole TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_notices_status ON notices(status);
    CREATE INDEX IF NOT EXISTS idx_notices_scheduledFor ON notices(scheduledFor);
    CREATE INDEX IF NOT EXISTS idx_notices_expiresAt ON notices(expiresAt);
    CREATE INDEX IF NOT EXISTS idx_notices_publishedAt ON notices(publishedAt);

    -- One audience group within a notice's targeting rules (e.g. "Students, Dept=CS,
    -- Semester=4"). A notice can have several — the union of every group's resolved recipients
    -- (deduplicated) is who actually receives it. filters is a JSON object validated server-side
    -- against a per-audience whitelist (see noticeTargeting.js) — never interpreted as raw SQL,
    -- and never trusted as a final recipient list on its own.
    CREATE TABLE IF NOT EXISTS notice_target_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noticeId INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      audience TEXT NOT NULL,
      filters TEXT NOT NULL DEFAULT '{}',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notice_target_groups_noticeId ON notice_target_groups(noticeId);

    -- The resolved recipient snapshot, written once when a notice is published (immediately or
    -- by the scheduler) — see "recipient snapshot vs dynamic targeting": a student's later
    -- department change never retroactively changes who already received this notice. One row
    -- per (notice, user) — UNIQUE prevents ever double-notifying someone who matched more than
    -- one target group. readAt/acknowledgedAt are this feature's own richer tracking, separate
    -- from notifications.isRead (the bell), same "two separate read states for two separate
    -- purposes" precedent as course_activity_reads.
    CREATE TABLE IF NOT EXISTS notice_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noticeId INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'delivered',
      deliveredAt DATETIME,
      readAt DATETIME,
      acknowledgedAt DATETIME,
      UNIQUE(noticeId, userId)
    );
    CREATE INDEX IF NOT EXISTS idx_notice_recipients_noticeId ON notice_recipients(noticeId);
    CREATE INDEX IF NOT EXISTS idx_notice_recipients_userId ON notice_recipients(userId);

    -- Files attached to a notice (bytes stored on disk next to the database, same pattern as
    -- course_materials — see noticeAttachmentStorage.js).
    CREATE TABLE IF NOT EXISTS notice_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noticeId INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      fileName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      fileSize INTEGER,
      uploadedBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notice_attachments_noticeId ON notice_attachments(noticeId);

    -- Non-unique indexes on hot foreign-key lookup columns — these tables were
    -- previously relying on full scans for every enrollment/roster/attendance/
    -- payment lookup keyed by student or course.
    CREATE INDEX IF NOT EXISTS idx_enrollments_studentId ON enrollments(studentId);
    CREATE INDEX IF NOT EXISTS idx_enrollments_courseId ON enrollments(courseId);
    CREATE INDEX IF NOT EXISTS idx_courses_departmentId ON courses(departmentId);
    CREATE INDEX IF NOT EXISTS idx_courses_teacherId ON courses(teacherId);
    CREATE INDEX IF NOT EXISTS idx_slots_courseId ON timetable_slots(courseId);
    CREATE INDEX IF NOT EXISTS idx_attendance_studentId ON attendance(studentId);
    CREATE INDEX IF NOT EXISTS idx_payments_studentId ON payments(studentId);
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
  // Registration window shown on the Registrar dashboard's status pill — distinct from the
  // semester's own startDate/endDate, since registration can open before/close mid-semester.
  // NULL until an admin/registrar sets one; the pill falls back to isActive-only in that case.
  ensureColumn('terms', 'registrationOpensAt', 'TEXT');
  ensureColumn('terms', 'registrationClosesAt', 'TEXT');

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

  // Nullable — nothing sets these yet. Schema only, ahead of a future graduation-tracking phase.
  ensureColumn('student_profiles', 'graduationStatus', 'TEXT');
  ensureColumn('student_profiles', 'graduationDate', 'TEXT');
  ensureColumn('student_profiles', 'degreeAwarded', 'TEXT');

  // Denormalized mirror of the student's currently-open semester_records row (see
  // academicProgression.js) — lets every read site (Student Profile, Student Dashboard) show
  // "In Progress" / "Awaiting Results" / "Passed" / "Failed" / "On Hold" / "Graduation Eligible"
  // without a join. Always written together with the semester_records row it mirrors.
  ensureColumn('student_profiles', 'semesterStatus', "TEXT DEFAULT 'In Progress'");
  // Lifecycle status distinct from enrollmentStatus (which is a study-mode/standing flag —
  // Regular/Part-time/Probation/Withdrawn). Active/Graduated/Suspended/On Leave — admin-editable,
  // same ADMIN_FIELDS path as the rest of student_profiles.
  ensureColumn('student_profiles', 'studentStatus', "TEXT DEFAULT 'Active'");
  // Optional cap on how many semesters a program runs — when set, reaching it after a Passed
  // semester marks the student Graduation Eligible instead of opening semester N+1. When unset,
  // graduation eligibility instead falls back to totalCredits (see resolveGraduationEligibility
  // in academicProgression.js). Nullable — most programs work fine driven by credits alone.
  ensureColumn('programs', 'numberOfSemesters', 'INTEGER');

  // Free-text intake cohort label (e.g. "Fall 2024"), admin-editable, used by the Students page
  // as a lightweight "Batch/Session" filter — deliberately not a full batches entity (that would
  // overlap the not-yet-built Programs/Curriculum work); this is just a display+filter tag.
  ensureColumn('student_profiles', 'batch', 'TEXT');
  ensureColumn('student_profiles', 'photoPath', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_student_profiles_batch ON student_profiles(batch)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_student_profiles_studentStatus ON student_profiles(studentStatus)');

  // Canonical student record: every role='student' user must have a student_profiles row,
  // whichever path created the account (Admissions approval already created one; direct User
  // Management / bulk-import creation historically didn't — now fixed at the source in
  // accounts.js, but this backfill catches any account created before that fix, or by a script
  // that bypasses it). applicationId is the profile's own forward pointer to the application it
  // came from (nullable — a student created directly, with no application, is valid and stays
  // NULL); previously only the reverse pointer applications.createdStudentId existed.
  ensureColumn('student_profiles', 'applicationId', 'INTEGER');
  ensureColumn('student_profiles', 'enrollmentDate', 'TEXT');
  await run(`
    INSERT INTO student_profiles (studentId, enrollmentDate)
    SELECT id, DATE(createdAt) FROM users
    WHERE role = 'student' AND id NOT IN (SELECT studentId FROM student_profiles)
  `);
  await run(`
    UPDATE student_profiles SET applicationId = (
      SELECT a.id FROM applications a WHERE a.createdStudentId = student_profiles.studentId
    )
    WHERE applicationId IS NULL
      AND EXISTS (SELECT 1 FROM applications a WHERE a.createdStudentId = student_profiles.studentId)
  `);
  await run(`
    UPDATE student_profiles SET enrollmentDate = (
      SELECT DATE(u.createdAt) FROM users u WHERE u.id = student_profiles.studentId
    )
    WHERE enrollmentDate IS NULL
  `);

  // Every student needs an open semester_records row to have any progression history at all —
  // backfill one at their current programSemester (default 1) for anyone who predates this
  // feature. WHERE NOT EXISTS makes this safe to run on every startup: a student who already has
  // any semester_records row (open or historical) is left alone.
  await run(`
    INSERT INTO semester_records (studentId, semesterNumber, termId, status)
    SELECT sp.studentId, COALESCE(sp.programSemester, 1), (SELECT id FROM terms WHERE isActive = 1 ORDER BY id DESC LIMIT 1), COALESCE(sp.semesterStatus, 'In Progress')
    FROM student_profiles sp
    WHERE NOT EXISTS (SELECT 1 FROM semester_records sr WHERE sr.studentId = sp.studentId)
  `);

  // Richer audit trail: which role the actor held at the time, plus before/after state for
  // writes that capture it (see logAudit()'s new optional params). Nullable — old rows and
  // actions with no meaningful before/after simply leave these blank.
  ensureColumn('audit_log', 'role', 'TEXT');
  ensureColumn('audit_log', 'oldValue', 'TEXT');
  ensureColumn('audit_log', 'newValue', 'TEXT');

  // Soft-delete for enrollments — an official academic record. DELETE /enrollments/:id now sets
  // status='dropped' + deletedAt instead of removing the row (see routes/enrollments.js), so a
  // student's enrollment history survives. Deliberately NOT applied to the course-deletion
  // cascade (routes/courses.js) — enrollments there still need a real DELETE, since a soft-deleted
  // row would keep referencing a courseId that's about to stop existing, tripping the FK
  // constraint (foreign_keys=ON). 'dropped' is already excluded by every existing query that
  // filters enrollments by status = 'enrolled' / IN ('enrolled','waitlisted') — which is nearly
  // all of them — so this needed no changes to those read sites.
  ensureColumn('enrollments', 'deletedAt', 'TEXT');

  // Voiding a payment must never destroy the record of it having existed (auditability) — instead
  // of DELETE FROM payments, routes/finance.js now flips status to 'reversed' and keeps the row.
  ensureColumn('payments', 'status', "TEXT DEFAULT 'completed'");
  ensureColumn('payments', 'voidedAt', 'DATETIME');
  ensureColumn('payments', 'voidedBy', 'INTEGER');

  // Receipts. termId is the term this payment was recorded against (whatever term was selected
  // in the UI at the time) — a display/reference tag only, since the ledger itself still pools
  // payments across terms (see finance.js header). receiptSnapshot is a JSON blob of everything
  // the receipt shows (student/term/invoice/allocation/previous+remaining balance), captured once
  // at recordPayment time via finance.buildReceiptSnapshot() and never touched again — a receipt
  // must read exactly the same after the fact even if a later payment/void reshuffles the live
  // installment allocation or the student's name changes. NULL on payments recorded before this
  // column existed; routes/finance.js reconstructs a best-effort receipt for those from the ledger.
  ensureColumn('payments', 'termId', 'INTEGER');
  ensureColumn('payments', 'receiptSnapshot', 'TEXT');

  // Backfills course_offerings from courses on every startup so it stays a superset of the
  // current courses table without ever being written to directly yet. WHERE NOT EXISTS makes
  // this safe to run on every restart — already-copied courses are skipped, not duplicated.
  await run(`
    INSERT INTO course_offerings (courseId, termId, section, teacherId, roomId, maxStudents)
    SELECT id, termId, NULL, teacherId, roomId, maxStudents FROM courses
    WHERE NOT EXISTS (SELECT 1 FROM course_offerings WHERE course_offerings.courseId = courses.id)
  `);

  // One-time backfill: mirror every historical, still-active payment into the new
  // finance_transactions ledger (type='payment', termId NULL — payments predate the per-term
  // model) so the new ledger-derived totals include pre-existing payment history instead of
  // silently dropping it. WHERE NOT EXISTS makes this safe to run on every startup —
  // already-migrated payments are skipped, not duplicated. Excludes status='reversed' rows: a
  // voided payment keeps its row (auditability) but its ledger entry is deliberately removed by
  // reversePaymentTransaction(), and this backfill must not resurrect it on the next restart.
  await run(`
    INSERT INTO finance_transactions (studentId, termId, type, amount, method, reference, description, relatedPaymentId, createdAt, createdBy)
    SELECT p.studentId, NULL, 'payment', p.amount, p.method, p.reference, p.note, p.id, p.paidAt, p.createdBy
    FROM payments p
    WHERE p.status != 'reversed' AND NOT EXISTS (SELECT 1 FROM finance_transactions ft WHERE ft.relatedPaymentId = p.id)
  `);

  // Hierarchical fee configuration: a student's program/degree track and configurable category
  // (Regular, International, Scholarship, ...), used by resolveFeeRule() in finance.js to pick
  // the most specific applicable fee-per-credit rate. Both nullable — a student with neither set
  // simply resolves down to the university-wide default, unchanged from today's behavior.
  ensureColumn('student_profiles', 'programId', 'INTEGER');
  ensureColumn('student_profiles', 'studentTypeId', 'INTEGER');

  // Which fee_rules row (if any) computed a tuition charge line's rate — an audit trail so a
  // later fee-configuration change can never be mistaken for having silently altered an already
  // generated invoice (the charge line's own frozen rate/amount already guarantees that; this
  // just records *why* that rate was what it was). No REFERENCES clause, matching every other
  // FK-shaped column added via ensureColumn in this file (e.g. departments.collegeId above) —
  // ALTER TABLE ADD COLUMN can't cleanly add one.
  ensureColumn('finance_charge_lines', 'sourceRuleId', 'INTEGER');

  // Extends fee_items (fixed fees) from the old all/dept-only appliesTo model to the same
  // scope hierarchy fee_rules uses, plus real fee metadata. appliesTo/appliesToId are left in
  // place (unused going forward) rather than dropped, per the "don't destroy data" rule; the
  // one-time backfill below copies their meaning into the new columns so existing fee items
  // keep applying to exactly the same students after upgrade.
  ensureColumn('fee_items', 'scope', 'TEXT');
  ensureColumn('fee_items', 'scopeId', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('fee_items', 'studentTypeId', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('fee_items', 'feeType', "TEXT NOT NULL DEFAULT 'other'");
  ensureColumn('fee_items', 'mandatory', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('fee_items', 'isActive', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('fee_items', 'effectiveDate', 'TEXT');
  await run(`
    UPDATE fee_items SET scope = CASE appliesTo WHEN 'dept' THEN 'department' ELSE 'university' END,
                          scopeId = COALESCE(appliesToId, 0)
    WHERE scope IS NULL
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_items_scope_unique ON fee_items(termId, name, scope, scopeId, studentTypeId)');

  // Default student type categories, seeded once — fully editable/deletable afterward via
  // routes/studentTypes.js, so this is a starting point, not a hardcoded list anything depends on.
  const studentTypeCount = await get('SELECT COUNT(*) as n FROM student_types');
  if (!studentTypeCount || studentTypeCount.n === 0) {
    const defaults = ['Regular', 'International', 'Scholarship', 'Sponsored', 'Transfer', 'Evening', 'Day'];
    for (let i = 0; i < defaults.length; i++) {
      await run('INSERT INTO student_types (name, sortOrder) VALUES (?, ?)', [defaults[i], i]);
    }
  }

  // Faculty onboarding expansion (additive only — every column nullable, no existing
  // teacher_profiles/teacher_education/teacher_documents row is touched by adding these).
  //
  // Personal.
  ensureColumn('teacher_profiles', 'employeeId', 'TEXT');
  ensureColumn('teacher_profiles', 'preferredName', 'TEXT');
  ensureColumn('teacher_profiles', 'fatherName', 'TEXT');
  ensureColumn('teacher_profiles', 'motherName', 'TEXT');
  ensureColumn('teacher_profiles', 'nationality', 'TEXT');
  ensureColumn('teacher_profiles', 'nationalId', 'TEXT');
  ensureColumn('teacher_profiles', 'maritalStatus', 'TEXT');
  // Contact. `address` (pre-existing) is treated as "current address"; `officialEmail` is the
  // university email — distinct from personalEmail, and separate from the linked login
  // account's users.email so a faculty member can have an official address before (or without)
  // ever getting a system account.
  ensureColumn('teacher_profiles', 'officialEmail', 'TEXT');
  ensureColumn('teacher_profiles', 'secondaryPhone', 'TEXT');
  ensureColumn('teacher_profiles', 'emergencyContactName', 'TEXT');
  ensureColumn('teacher_profiles', 'emergencyContactRelationship', 'TEXT');
  ensureColumn('teacher_profiles', 'emergencyContactPhone', 'TEXT');
  ensureColumn('teacher_profiles', 'permanentAddress', 'TEXT');
  ensureColumn('teacher_profiles', 'city', 'TEXT');
  ensureColumn('teacher_profiles', 'province', 'TEXT');
  ensureColumn('teacher_profiles', 'country', 'TEXT');
  ensureColumn('teacher_profiles', 'postalCode', 'TEXT');
  // Employment. College is deliberately NOT duplicated here — it's derived from the teacher's
  // department (departments.collegeId), same as everywhere else in the app.
  ensureColumn('teacher_profiles', 'contractStartDate', 'TEXT');
  ensureColumn('teacher_profiles', 'contractEndDate', 'TEXT');
  ensureColumn('teacher_profiles', 'officeRoom', 'TEXT');
  ensureColumn('teacher_profiles', 'reportingManagerId', 'INTEGER');
  ensureColumn('teacher_profiles', 'employeeCategory', 'TEXT');
  ensureColumn('teacher_profiles', 'payrollId', 'TEXT');
  ensureColumn('teacher_profiles', 'workLocation', 'TEXT');
  // Teaching/academic profile — free text; multi-entry lists (publications, awards) are stored
  // as newline-separated text rather than new tables, matching qualifiedSubjects' existing shape.
  ensureColumn('teacher_profiles', 'expertiseAreas', 'TEXT');
  ensureColumn('teacher_profiles', 'researchInterests', 'TEXT');
  ensureColumn('teacher_profiles', 'teachingInterests', 'TEXT');
  ensureColumn('teacher_profiles', 'publications', 'TEXT');
  ensureColumn('teacher_profiles', 'awards', 'TEXT');
  ensureColumn('teacher_profiles', 'officeHours', 'TEXT');

  // Qualifications get the same country/verification/transcript treatment as the new
  // certifications/experience tables, plus a separate startYear (year already means graduation
  // year for every pre-existing row, left untouched).
  ensureColumn('teacher_education', 'country', 'TEXT');
  ensureColumn('teacher_education', 'startYear', 'INTEGER');
  ensureColumn('teacher_education', 'gpa', 'TEXT');
  ensureColumn('teacher_education', 'verificationStatus', "TEXT NOT NULL DEFAULT 'Pending'");
  ensureColumn('teacher_education', 'transcriptPath', 'TEXT');
  ensureColumn('teacher_education', 'notes', 'TEXT');

  // Document verification workflow. Existing rows default to 'Pending' (nothing was ever
  // verified before this column existed), matching teacher_education/teacher_experience/
  // teacher_certifications' own default.
  ensureColumn('teacher_documents', 'issueDate', 'TEXT');
  ensureColumn('teacher_documents', 'expiryDate', 'TEXT');
  ensureColumn('teacher_documents', 'verificationStatus', "TEXT NOT NULL DEFAULT 'Pending'");
  ensureColumn('teacher_documents', 'verifiedBy', 'INTEGER');
  ensureColumn('teacher_documents', 'verifiedAt', 'DATETIME');
  ensureColumn('teacher_documents', 'notes', 'TEXT');

  // Financial aid decided during admissions review, carried on the application itself so Finance
  // can auto-apply it at charge-generation time instead of a Bursar re-entering it manually (see
  // finance.js's syncApplicationAid). type/basis mirror student_financial_aid's own type/basis.
  ensureColumn('applications', 'aidType', 'TEXT');
  ensureColumn('applications', 'aidBasis', 'TEXT');
  ensureColumn('applications', 'aidValue', 'REAL');
  ensureColumn('applications', 'aidReason', 'TEXT');
  // Links an auto-applied aid award back to the application that specified it, so
  // syncApplicationAid can tell an application-sourced award apart from a manually-awarded one
  // and detect when the application's aid figures have since changed.
  ensureColumn('student_financial_aid', 'applicationId', 'INTEGER');

  await seedAuthzTables();
}

// The four actions every module is seeded with. READ in the legacy POLICY maps to just View;
// WRITE maps to all four — this keeps day-one access identical to the old model while giving
// every grant a real Module.Action row to refine later (e.g. splitting Grades.Enter from
// Grades.Approve once that workflow exists) without re-touching every other role's access.
const CRUD_ACTIONS = ['View', 'Create', 'Update', 'Delete'];

// A few modules need finer-grained actions than the generic CRUD set (e.g. an announcement's
// lifecycle has separate Publish/Schedule/Archive steps, plus who may see recipient lists/
// analytics). Appended on top of CRUD_ACTIONS for WRITE-level roles only, same as every other
// seeded permission — additive, doesn't touch any other module's seeding.
const EXTRA_ACTIONS = {
  announcements: ['Publish', 'Schedule', 'Archive', 'ManageRecipients', 'ViewAnalytics'],
  // Evaluate/advance/override a student's semester progression (routes/progression.js) — a
  // distinct action from the generic students CRUD, since it triggers automatic academic-record
  // writes rather than a simple field edit. Seeded for every WRITE-level role on 'students'
  // (registrar, records_officer) same as everything else in this table.
  students: ['Progress'],
};

/** Seeds permissions/role_permissions from the legacy POLICY (permissions.js) — idempotent
    (INSERT OR IGNORE), safe to run on every startup. Never removes a role_permissions row, so
    a grant added directly in the DB later survives even if POLICY doesn't mention it. */
async function seedAuthzTables() {
  for (const module of MODULES) {
    for (const action of [...CRUD_ACTIONS, ...(EXTRA_ACTIONS[module] || [])]) {
      await run('INSERT OR IGNORE INTO permissions (module, action) VALUES (?, ?)', [module, action]);
    }
  }
  const permissionRows = await all('SELECT id, module, action FROM permissions');
  const permIdFor = (module, action) => permissionRows.find(p => p.module === module && p.action === action)?.id;

  for (const role of Object.keys(ROLES)) {
    for (const module of MODULES) {
      const level = levelFor(role, module);
      if (level === NONE) continue;
      const actions = level === WRITE ? [...CRUD_ACTIONS, ...(EXTRA_ACTIONS[module] || [])] : ['View'];
      for (const action of actions) {
        const permissionId = permIdFor(module, action);
        if (!permissionId) continue;
        await run('INSERT OR IGNORE INTO role_permissions (role, permissionId) VALUES (?, ?)', [role, permissionId]);
      }
    }
  }

  // Mirrors users.departmentId/collegeId into the generalized user_scopes table (see its schema
  // comment) — those two columns stay the enforced source of truth via scope.js; this is purely
  // an additive, queryable reflection of the same facts for the new authz layer to use later.
  const scopedUsers = await all('SELECT id, departmentId, collegeId FROM users WHERE departmentId IS NOT NULL OR collegeId IS NOT NULL');
  for (const u of scopedUsers) {
    if (u.departmentId != null) {
      await run('INSERT OR IGNORE INTO user_scopes (userId, scopeType, scopeId) VALUES (?, ?, ?)', [u.id, 'department', u.departmentId]);
    }
    if (u.collegeId != null) {
      await run('INSERT OR IGNORE INTO user_scopes (userId, scopeType, scopeId) VALUES (?, ?, ?)', [u.id, 'college', u.collegeId]);
    }
  }

  // Narrow, one-time retraction (not a general "resync role_permissions from POLICY" mechanism —
  // this seed is additive-only by design, see the function comment above): Viewer's finance/audit
  // access was removed from POLICY in the 2026-07-28 RBAC hardening pass, but a database seeded
  // before that change would still have the old grants sitting in role_permissions from
  // INSERT OR IGNORE. Neither module reads role_permissions today (both still use the legacy
  // can()/POLICY path), so this is precautionary for when they migrate, not a live fix by itself.
  await run(`DELETE FROM role_permissions WHERE role = 'viewer' AND permissionId IN (
    SELECT id FROM permissions WHERE module IN ('finance', 'audit'))`);
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

/** Next EMP-YYYY-NNNN id for a faculty HR profile (teacher_profiles.employeeId) — same format/
    prefix as a faculty or admin login account's users.idNumber (idPrefixFor treats both roles
    identically), and deliberately drawn from the union of both pools so a teacher onboarded
    before ever getting a login account can't later collide with an admin/faculty account's own
    idNumber once one is assigned. */
async function nextEmployeeId(year = new Date().getFullYear()) {
  const prefix = idPrefixFor('faculty', year);
  const fromUsers = (await all('SELECT idNumber FROM users WHERE idNumber LIKE ?', [prefix + '%'])).map(r => r.idNumber);
  const fromProfiles = (await all('SELECT employeeId FROM teacher_profiles WHERE employeeId LIKE ?', [prefix + '%'])).map(r => r.employeeId);
  return formatIdNumber('faculty', year, nextSequenceNumber(prefix, [...fromUsers, ...fromProfiles]));
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

/** Records an admin/faculty action for the audit log. `user` is the JWT payload (req.user): { sub,
    email, role }. `oldValue`/`newValue` (optional — plain objects, JSON-serialized) capture a
    write's before/after state for sensitive changes; omit them for actions with no meaningful
    before/after (e.g. a login event) — existing call sites that don't pass them are unaffected.
    Never throws — a logging failure must not break the underlying request. */
async function logAudit(user, action, entityType, entityId, details, oldValue, newValue) {
  try {
    await run(
      'INSERT INTO audit_log (userId, userName, role, action, entityType, entityId, details, oldValue, newValue) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        user?.sub ?? null, user?.email ?? 'Unknown', user?.role ?? null, action, entityType, entityId ?? null,
        details ? JSON.stringify(details) : null,
        oldValue == null ? null : JSON.stringify(oldValue),
        newValue == null ? null : JSON.stringify(newValue),
      ]
    );
  } catch (err) {
    console.error('Failed to write audit log entry:', err.message);
  }
}

/** Runs `fn` (an async function making run()/get()/all() calls) inside a single SQLite
    transaction — commits if it resolves, rolls back and rethrows if it throws. For callers
    doing several dependent writes that must all succeed or none at all (see
    routes/superAdmin.js's system reset). */
async function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = await fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
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

module.exports = { run, get, all, init, findUserByEmail, createUser, logAudit, backupTo, restoreFrom, transaction, DB_PATH, nextIdNumberForRole, nextEmployeeId };
