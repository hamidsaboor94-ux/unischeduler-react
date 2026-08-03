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
    // Same one-time-snapshot rationale ahead of the Curriculum Management tables below
    // (curriculum/curriculum_semester/elective_group/curriculum_course/student_curriculum/holds).
    const hasCurriculum = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='curriculum'").get();
    if (hasUsers && !hasCurriculum) {
      const backupDir = path.join(path.dirname(DB_PATH), 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await backupTo(path.join(backupDir, `pre-curriculum-migration-${stamp}.sqlite`));
    }
    const hasCurriculumHistory = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='student_curriculum_history'").get();
    if (hasUsers && hasCurriculum && !hasCurriculumHistory) {
      const backupDir = path.join(path.dirname(DB_PATH), 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await backupTo(path.join(backupDir, `pre-curriculum-phase2-${stamp}.sqlite`));
    }
    const hasGraduationApplications = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='graduation_applications'").get();
    if (hasUsers && !hasGraduationApplications) {
      const backupDir = path.join(path.dirname(DB_PATH), 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await backupTo(path.join(backupDir, `pre-graduation-workflow-${stamp}.sqlite`));
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

    CREATE TABLE IF NOT EXISTS notification_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(userId, category)
    );

    CREATE TABLE IF NOT EXISTS notification_delivery_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipientUserId INTEGER,
      type TEXT,
      entityType TEXT,
      entityId INTEGER,
      error TEXT NOT NULL,
      deduplicationKey TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS published_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      letterGrade TEXT NOT NULL,
      publishedBy INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      publishedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(courseId,studentId)
    );

    -- Generic approval-chain engine (see approvalEngine.js): one request/review/decision shape
    -- shared by every "submit -> reviewed by an ordered chain of role-owned steps -> approved/
    -- rejected" flow (appeals today; leave, readmission, graduation clearance, financial aid later
    -- each register their own chain + effect instead of hand-rolling a new status machine).
    CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      subjectType TEXT NOT NULL,
      subjectId INTEGER NOT NULL REFERENCES users(id),
      requestedBy INTEGER NOT NULL REFERENCES users(id),
      payload TEXT,
      currentStepOrder INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'In Review',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- The ordered chain of reviewer roles for a given request 'type' — lazily upserted by
    -- approvalEngine.js's registerRequestType()/ensureChainSeeded() the first time that type is
    -- actually used, not hand-edited here.
    CREATE TABLE IF NOT EXISTS approval_chain_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      stepOrder INTEGER NOT NULL,
      role TEXT NOT NULL,
      label TEXT,
      UNIQUE(type, stepOrder)
    );

    -- One row per decision made on a request (approve / reject / return). A 'return' sends the
    -- request back to the requester for more info; a resubmission re-enters the SAME step, which
    -- can produce a second decision row at that stepOrder.
    CREATE TABLE IF NOT EXISTS approval_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requestId INTEGER NOT NULL REFERENCES approval_requests(id),
      stepOrder INTEGER NOT NULL,
      reviewerId INTEGER NOT NULL REFERENCES users(id),
      decision TEXT NOT NULL,
      note TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- A saved custom report (see reportBuilder.js / reportEntities.js): 'entity' is a whitelisted
    -- key (e.g. 'students'), 'config' is the JSON {columns, filters, groupBy, aggregate, sort}
    -- consumed by buildQuery() -- never raw SQL. Re-running a saved definition re-validates its
    -- config against the current whitelist, so a field removed later just drops out quietly.
    CREATE TABLE IF NOT EXISTS report_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      entity TEXT NOT NULL,
      config TEXT NOT NULL,
      chartType TEXT,
      createdBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
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

    -- One canonical row per conferred degree, written exclusively by POST
    -- /api/graduation/confirm/:studentId (routes/graduation.js). student_profiles'
    -- graduationStatus/graduationDate/degreeAwarded mirror the latest row here for fast reads,
    -- same "ledger + mirrored summary" relationship semester_records has with student_profiles.
    CREATE TABLE IF NOT EXISTS graduation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      degreeAwarded TEXT NOT NULL,
      graduationDate TEXT NOT NULL,
      conferredBy INTEGER REFERENCES users(id),
      certificateNumber TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_graduation_records_studentId ON graduation_records(studentId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_graduation_records_certificateNumber ON graduation_records(certificateNumber);

    -- A program attempt is distinct from the student's identity. Existing profile.programId stays
    -- as the current-program pointer; rows are created only through an explicit graduation or
    -- future admissions workflow, never silently inferred during migration.
    CREATE TABLE IF NOT EXISTS student_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      programId INTEGER NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
      admissionDate TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      createdBy INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_student_programs_student ON student_programs(studentId, status);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_student_programs_one_open
      ON student_programs(studentId, programId) WHERE status IN ('active','on_leave','suspended');

    CREATE TABLE IF NOT EXISTS graduation_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      studentProgramId INTEGER NOT NULL REFERENCES student_programs(id) ON DELETE RESTRICT,
      expectedGraduationTermId INTEGER REFERENCES terms(id) ON DELETE RESTRICT,
      applicationDate TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      submittedBy INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewedBy INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      reviewedAt DATETIME,
      decisionReason TEXT,
      notes TEXT,
      approvalRequestId INTEGER REFERENCES approval_requests(id) ON DELETE RESTRICT,
      lastEvaluatedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_graduation_applications_student ON graduation_applications(studentId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_graduation_applications_status ON graduation_applications(status, expectedGraduationTermId);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_graduation_application_active
      ON graduation_applications(studentProgramId, COALESCE(expectedGraduationTermId, -1))
      WHERE status IN ('submitted','under_review','corrections_required','approved');

    CREATE TABLE IF NOT EXISTS graduation_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      studentProgramId INTEGER REFERENCES student_programs(id) ON DELETE RESTRICT,
      graduationApplicationId INTEGER REFERENCES graduation_applications(id) ON DELETE RESTRICT,
      graduationRecordId INTEGER REFERENCES graduation_records(id) ON DELETE RESTRICT,
      result TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'evaluation',
      evaluatedBy INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_graduation_audits_application ON graduation_audits(graduationApplicationId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_graduation_audits_record ON graduation_audits(graduationRecordId);

    CREATE TABLE IF NOT EXISTS graduation_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      curriculumId INTEGER NOT NULL REFERENCES curriculum(id) ON DELETE RESTRICT,
      requirementType TEXT NOT NULL,
      label TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(curriculumId, requirementType)
    );

    CREATE TABLE IF NOT EXISTS graduation_requirement_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graduationApplicationId INTEGER NOT NULL REFERENCES graduation_applications(id) ON DELETE RESTRICT,
      requirementType TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      evidence TEXT,
      verifiedBy INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      verifiedAt DATETIME,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(graduationApplicationId, requirementType)
    );

    CREATE TABLE IF NOT EXISTS graduation_issuance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graduationRecordId INTEGER NOT NULL REFERENCES graduation_records(id) ON DELETE RESTRICT,
      documentType TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      notes TEXT,
      actedBy INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      collectedBy TEXT,
      actedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_graduation_issuance_record ON graduation_issuance_events(graduationRecordId, documentType, actedAt DESC);

    CREATE TABLE IF NOT EXISTS graduation_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graduationRecordId INTEGER NOT NULL REFERENCES graduation_records(id) ON DELETE RESTRICT,
      correctionType TEXT NOT NULL,
      reason TEXT NOT NULL,
      previousValue TEXT,
      correctedValue TEXT,
      authorizedBy INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

    -- Data Migration Center (see migration/engine.js): insert-only import of external data
    -- (SQL sources via information_schema, or CSV/Excel files) into this app's own tables.
    -- migration_connections holds saved source-DB credentials for reuse across runs; the
    -- password is AES-GCM encrypted (migration/crypto.js) and NULL for file-based sources.
    CREATE TABLE IF NOT EXISTS migration_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      configJson TEXT NOT NULL,
      encryptedPassword TEXT,
      createdBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- One row per migration run. status walks draft -> discovering -> mapped -> validated ->
    -- dry_run -> running -> completed|failed|cancelled, with a separate rolled_back terminal
    -- state reachable from completed. The counters/currentTable columns are the durable fallback
    -- for GET /migrations/:id/progress when the in-memory progress map (migration/progress.js)
    -- doesn't have an entry (server restarted mid-run, or querying a finished migration).
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT,
      sourceType TEXT NOT NULL,
      connectionId INTEGER REFERENCES migration_connections(id),
      sourceFilePath TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      discoverySnapshotJson TEXT,
      snapshotPath TEXT,
      cancelRequested INTEGER NOT NULL DEFAULT 0,
      totalTables INTEGER,
      totalRows INTEGER,
      processedRows INTEGER NOT NULL DEFAULT 0,
      insertedRows INTEGER NOT NULL DEFAULT 0,
      errorRows INTEGER NOT NULL DEFAULT 0,
      currentTable TEXT,
      lastDryRunSummaryJson TEXT,
      errorMessage TEXT,
      startedAt DATETIME,
      finishedAt DATETIME,
      createdBy INTEGER REFERENCES users(id),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_migrations_status ON migrations(status);

    -- Saved column mapping per source table -> destination target (migration/destinationTargets.js
    -- registry key, not always a literal table name — e.g. 'students' fans out to users +
    -- student_profiles). importOrder is the resolved topological position (dependency order),
    -- computed and stored when the mapping is saved so the import loop never re-sorts mid-run.
    CREATE TABLE IF NOT EXISTS migration_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migrationId INTEGER NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
      sourceTable TEXT NOT NULL,
      destinationTarget TEXT NOT NULL,
      columnMapJson TEXT NOT NULL,
      importOrder INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(migrationId, sourceTable)
    );
    CREATE INDEX IF NOT EXISTS idx_migration_mappings_migrationId ON migration_mappings(migrationId);

    -- Per-batch audit trail (~500 rows/batch) backing the Report step and giving rollback/
    -- diagnostics a record independent of re-scanning every destination table. 'phase'
    -- distinguishes a dry run's batches from the real import's — both write here (see
    -- migration/engine.js's runBody(), shared between the two), and without it the Report step
    -- couldn't tell them apart for a migration that was dry-run more than once before importing.
    CREATE TABLE IF NOT EXISTS migration_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migrationId INTEGER NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
      sourceTable TEXT NOT NULL,
      destinationTarget TEXT NOT NULL,
      batchNumber INTEGER NOT NULL,
      rowCount INTEGER NOT NULL,
      insertedCount INTEGER NOT NULL,
      errorCount INTEGER NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'import',
      startedAt DATETIME,
      finishedAt DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_migration_batches_migrationId ON migration_batches(migrationId);

    -- Validation/insert errors only (never one row per successful insert — that would be
    -- unbounded on a large import); successful counts live on migrations/migration_batches.
    -- 'phase' — see migration_batches' comment above, same reasoning.
    CREATE TABLE IF NOT EXISTS migration_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migrationId INTEGER NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      sourceTable TEXT,
      sourceRowRef TEXT,
      message TEXT NOT NULL,
      detailsJson TEXT,
      phase TEXT NOT NULL DEFAULT 'import',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_migration_logs_migrationId ON migration_logs(migrationId);

    -- Curriculum Management (Phase 1: schema only — no validators/authoring UI yet).
    -- One curriculum row is one versioned "plan" for a program (e.g. Computer Science, 2025-2026):
    -- Program (programs) -> Version (curriculum) -> Semester (curriculum_semester) ->
    -- Courses (curriculum_course). academicYear is a plain label, not a FK — this schema has no
    -- academic_years table (only per-term terms), so it's freeform text like '2025-2026' until
    -- that concept exists. status is app-validated, not a CHECK constraint, matching every other
    -- lifecycle status column in this file (enrollments.status, approval_requests.status, ...).
    CREATE TABLE IF NOT EXISTS curriculum (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      programId INTEGER NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
      curriculumName TEXT NOT NULL,
      academicYear TEXT,
      effectiveFrom TEXT,
      effectiveTo TEXT,
      totalCredits INTEGER,
      status TEXT NOT NULL DEFAULT 'Draft',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_curriculum_programId ON curriculum(programId);

    CREATE TABLE IF NOT EXISTS curriculum_semester (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      curriculumId INTEGER NOT NULL REFERENCES curriculum(id) ON DELETE RESTRICT,
      semesterNumber INTEGER NOT NULL,
      name TEXT,
      minimumCredits INTEGER,
      maximumCredits INTEGER,
      UNIQUE(curriculumId, semesterNumber)
    );
    CREATE INDEX IF NOT EXISTS idx_curriculum_semester_curriculumId ON curriculum_semester(curriculumId);

    CREATE TABLE IF NOT EXISTS elective_group (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      curriculumId INTEGER NOT NULL REFERENCES curriculum(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      requiredCount INTEGER,
      requiredCredits REAL
    );
    CREATE INDEX IF NOT EXISTS idx_elective_group_curriculumId ON elective_group(curriculumId);

    -- courseId points at a row in courses, which (per this schema's existing design) is itself
    -- a per-term row, not a term-independent catalog entry -- there is no course-catalog table to
    -- reference instead. A curriculum listing is therefore pinned to whichever course row it was
    -- authored against; matching a student's actual completions across terms will need to join on
    -- courses.code, not courseId. Flagged here for whoever builds the Phase 2 validator.
    CREATE TABLE IF NOT EXISTS curriculum_course (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      curriculumSemesterId INTEGER NOT NULL REFERENCES curriculum_semester(id) ON DELETE RESTRICT,
      courseId INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      required INTEGER NOT NULL DEFAULT 1,
      electiveGroupId INTEGER REFERENCES elective_group(id) ON DELETE RESTRICT,
      minimumGrade TEXT,
      sequence INTEGER,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_curriculum_course_curriculumSemesterId ON curriculum_course(curriculumSemesterId);
    CREATE INDEX IF NOT EXISTS idx_curriculum_course_courseId ON curriculum_course(courseId);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_curriculum_course_semester_course
      ON curriculum_course(curriculumSemesterId, courseId);

    -- One row per student once assigned to a curriculum version; no row = curriculum checks are
    -- skipped for that student (deliberate for existing students -- see the startup backfill log
    -- below, which reports how many are currently unassigned rather than guessing a grandfather
    -- rule).
    CREATE TABLE IF NOT EXISTS student_curriculum (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      curriculumId INTEGER NOT NULL REFERENCES curriculum(id) ON DELETE RESTRICT,
      assignedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(studentId)
    );

    -- Append-only assignment history. student_curriculum remains the single-current-assignment
    -- pointer for backward compatibility; every assignment/reassignment is also recorded here.
    CREATE TABLE IF NOT EXISTS student_curriculum_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      curriculumId INTEGER NOT NULL REFERENCES curriculum(id) ON DELETE RESTRICT,
      assignedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      assignedBy INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      endedAt DATETIME,
      endedBy INTEGER REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_student_curriculum_history_student
      ON student_curriculum_history(studentId, assignedAt DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_student_curriculum_history_active
      ON student_curriculum_history(studentId) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS curriculum_registration_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      courseId INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      curriculumId INTEGER NOT NULL REFERENCES curriculum(id) ON DELETE RESTRICT,
      reason TEXT NOT NULL,
      approvedBy INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Generic hold, so graduation clearance (and later, registration) can query one shape instead
    -- of each blocking condition inventing its own flag. Distinct from finance.js's
    -- hasFinancialHold(), which is a computed (balance > 0) view over finance_transactions, not a
    -- persisted row -- nothing currently writes a 'financial' row here; that reconciliation is a
    -- later phase's decision, not assumed by this migration.
    CREATE TABLE IF NOT EXISTS holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      type TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
      placedBy INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_holds_studentId ON holds(studentId);

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
  ensureColumn('notifications', 'title', 'TEXT');
  ensureColumn('notifications', 'severity', "TEXT DEFAULT 'info'");
  ensureColumn('notifications', 'actionSection', 'TEXT');
  ensureColumn('notifications', 'actionData', 'TEXT');
  ensureColumn('notifications', 'metadata', 'TEXT');
  ensureColumn('notifications', 'deduplicationKey', 'TEXT');
  ensureColumn('notifications', 'createdBy', 'INTEGER');
  ensureColumn('notifications', 'readAt', 'DATETIME');
  ensureColumn('courses', 'resultsPublishedAt', 'DATETIME');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_deduplication ON notifications(deduplicationKey) WHERE deduplicationKey IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(userId,isRead,createdAt DESC)');

  // Written exclusively by POST /api/graduation/confirm/:studentId (routes/graduation.js), which
  // mirrors the fields of the graduation_records row it just inserted here for join-free reads
  // (transcript.js, profile pages). Nullable until a degree is actually conferred.
  ensureColumn('student_profiles', 'graduationStatus', 'TEXT');
  ensureColumn('student_profiles', 'graduationDate', 'TEXT');
  ensureColumn('student_profiles', 'degreeAwarded', 'TEXT');

  // Graduation workflow phase 2 expands the original degree ledger in place. Nullable columns
  // keep every legacy row readable while the reconciliation preview identifies what is missing.
  ensureColumn('graduation_records', 'graduateNumber', 'TEXT');
  ensureColumn('graduation_records', 'studentProgramId', 'INTEGER');
  ensureColumn('graduation_records', 'programId', 'INTEGER');
  ensureColumn('graduation_records', 'curriculumId', 'INTEGER');
  ensureColumn('graduation_records', 'graduationApplicationId', 'INTEGER');
  ensureColumn('graduation_records', 'graduationTermId', 'INTEGER');
  ensureColumn('graduation_records', 'completionDate', 'TEXT');
  ensureColumn('graduation_records', 'officialGraduationDate', 'TEXT');
  ensureColumn('graduation_records', 'degreeClassification', 'TEXT');
  ensureColumn('graduation_records', 'finalGpa', 'REAL');
  ensureColumn('graduation_records', 'totalCreditsCompleted', 'REAL');
  ensureColumn('graduation_records', 'honorsOrDistinction', 'TEXT');
  ensureColumn('graduation_records', 'thesisTitle', 'TEXT');
  ensureColumn('graduation_records', 'certificateStatus', "TEXT DEFAULT 'not_generated'");
  ensureColumn('graduation_records', 'certificateIssuedAt', 'DATETIME');
  ensureColumn('graduation_records', 'transcriptStatus', "TEXT DEFAULT 'pending'");
  ensureColumn('graduation_records', 'transcriptIssuedAt', 'DATETIME');
  ensureColumn('graduation_records', 'approvedBy', 'INTEGER');
  ensureColumn('graduation_records', 'approvedAt', 'DATETIME');
  ensureColumn('graduation_records', 'finalizedBy', 'INTEGER');
  ensureColumn('graduation_records', 'finalizedAt', 'DATETIME');
  ensureColumn('graduation_records', 'recordStatus', "TEXT DEFAULT 'active'");
  ensureColumn('graduation_records', 'notes', 'TEXT');
  ensureColumn('graduation_records', 'updatedAt', 'DATETIME');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_graduation_records_graduate_number ON graduation_records(graduateNumber) WHERE graduateNumber IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_graduation_records_student_program ON graduation_records(studentProgramId) WHERE studentProgramId IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_graduation_records_term_program ON graduation_records(graduationTermId, programId)');

  // Records written by the original /graduation/confirm workflow are already legitimate degree
  // awards: they have a graduation date, degree, conferring actor and certificate number. Preserve
  // and expose those records in the richer registry without inventing an application or approval
  // history that never existed. The migration is deliberately limited to canonical legacy
  // graduation_records rows; a profile merely marked Graduated without a record still goes to the
  // explicit reconciliation queue in graduationService.js.
  await run(`
    UPDATE graduation_records
    SET graduateNumber = COALESCE(graduateNumber,
          printf('GR-%s-%06d', COALESCE(NULLIF(substr(graduationDate,1,4),''), strftime('%Y',createdAt), strftime('%Y','now')), id)),
        programId = COALESCE(programId, (SELECT programId FROM student_profiles WHERE studentId=graduation_records.studentId)),
        completionDate = COALESCE(completionDate, graduationDate),
        officialGraduationDate = COALESCE(officialGraduationDate, graduationDate),
        certificateStatus = CASE WHEN certificateStatus IS NULL OR certificateStatus='not_generated' THEN 'generated' ELSE certificateStatus END,
        approvedBy = COALESCE(approvedBy, conferredBy),
        approvedAt = COALESCE(approvedAt, createdAt),
        finalizedBy = COALESCE(finalizedBy, conferredBy),
        finalizedAt = COALESCE(finalizedAt, createdAt),
        recordStatus = COALESCE(recordStatus, 'active'),
        notes = CASE WHEN notes IS NULL OR notes='' THEN
          'Migrated from the legacy graduation workflow; application and ordered approval history were not captured by that workflow.'
          ELSE notes END,
        updatedAt = COALESCE(updatedAt, CURRENT_TIMESTAMP)
    WHERE finalizedAt IS NULL
      AND graduationDate IS NOT NULL
      AND degreeAwarded IS NOT NULL
      AND certificateNumber IS NOT NULL
  `);
  // Denormalized mirror of the student's currently-open semester_records row (see
  // academicProgression.js) — lets every read site (Student Profile, Student Dashboard) show
  // "In Progress" / "Awaiting Results" / "Passed" / "Failed" / "On Hold" / "Graduation Eligible"
  // without a join. Always written together with the semester_records row it mirrors.
  ensureColumn('student_profiles', 'semesterStatus', "TEXT DEFAULT 'In Progress'");
  // Lifecycle status distinct from enrollmentStatus (which is a study-mode/standing flag —
  // Regular/Part-time/Probation/Withdrawn). Active/Suspended/Withdrawn/On Leave are admin-editable
  // via ADMIN_FIELDS; 'Graduated' is set exclusively by POST /api/graduation/confirm/:studentId
  // (routes/studentProfile.js and routes/students.js both reject it) since it requires the
  // eligibility + financial-clearance checks that live there.
  ensureColumn('student_profiles', 'studentStatus', "TEXT DEFAULT 'Active'");
  await run(`
    UPDATE student_profiles
    SET semesterStatus='Completed'
    WHERE studentStatus='Graduated'
      AND EXISTS (SELECT 1 FROM graduation_records gr WHERE gr.studentId=student_profiles.studentId AND gr.finalizedAt IS NOT NULL)
  `);
  // Optional cap on how many semesters a program runs — when set, reaching it after a Passed
  // semester marks the student Graduation Eligible instead of opening semester N+1. When unset,
  // graduation eligibility instead falls back to totalCredits (see resolveGraduationEligibility
  // in academicProgression.js). Nullable — most programs work fine driven by credits alone.
  ensureColumn('programs', 'numberOfSemesters', 'INTEGER');

  // Curriculum Phase 2 additions. Kept as ensureColumn migrations so existing installations
  // retain every Phase 1 row and can migrate idempotently at startup.
  ensureColumn('curriculum', 'catalogYear', 'TEXT');
  ensureColumn('curriculum', 'totalRequiredCredits', 'INTEGER');
  ensureColumn('curriculum_semester', 'createdAt', 'DATETIME');
  ensureColumn('curriculum_semester', 'updatedAt', 'DATETIME');
  ensureColumn('elective_group', 'minimumCourses', 'INTEGER');
  ensureColumn('elective_group', 'minimumCredits', 'REAL');
  ensureColumn('elective_group', 'maximumCourses', 'INTEGER');
  ensureColumn('elective_group', 'description', 'TEXT');
  ensureColumn('elective_group', 'createdAt', 'DATETIME');
  ensureColumn('elective_group', 'updatedAt', 'DATETIME');
  ensureColumn('curriculum_course', 'courseType', "TEXT DEFAULT 'required'");
  ensureColumn('curriculum_course', 'minimumPassingGrade', 'TEXT');
  ensureColumn('curriculum_course', 'recommendedSequence', 'INTEGER');
  ensureColumn('curriculum_course', 'createdAt', 'DATETIME');
  ensureColumn('curriculum_course', 'updatedAt', 'DATETIME');
  ensureColumn('student_curriculum', 'assignedBy', 'INTEGER');
  ensureColumn('student_curriculum', 'status', "TEXT DEFAULT 'active'");
  ensureColumn('student_curriculum', 'notes', 'TEXT');

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

  // Withdrawal: a second, distinct soft-delete outcome for enrollments.js's DELETE endpoint.
  // Unlike 'dropped' (pre-deadline, erased from the academic record), 'withdrawn' happens on/after
  // a term's registrationClosesAt and DOES stay on the transcript (as "W" — see routes/transcript.js)
  // with zero GPA impact, since computeAcademicSummary only ever counts status='enrolled' rows.
  // withdrawalDate/withdrawalReason are only populated for that outcome.
  ensureColumn('enrollments', 'withdrawalDate', 'TEXT');
  ensureColumn('enrollments', 'withdrawalReason', 'TEXT');

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

  // Prerequisite eligibility engine (see eligibility.js). groupId groups rows into OR-sets: NULL
  // means "required" (AND with every other row on this course); rows sharing the same non-null
  // (courseId, groupId) are OR'd — satisfying any one member satisfies that requirement. type
  // distinguishes a true prerequisite (must be completed beforehand) from a corequisite (may be
  // satisfied by concurrent/in-progress enrollment).
  ensureColumn('course_prerequisites', 'groupId', 'INTEGER');
  ensureColumn('course_prerequisites', 'type', "TEXT NOT NULL DEFAULT 'prerequisite'");

  // Optional program scope for a course, used by the eligibility engine's "student is in the
  // program associated with the course" gate. Nullable and fails open (same convention as
  // departmentId's existing eligibility check) — a course with no program set is open to every
  // program, so this never silently locks students out of a course nobody bothered to scope.
  ensureColumn('courses', 'programId', 'INTEGER');

  db.exec('CREATE INDEX IF NOT EXISTS idx_approval_requests_subject ON approval_requests(subjectType, subjectId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_approval_decisions_request ON approval_decisions(requestId)');

  // Data Migration Center provenance/rollback key (migration/adapters/SqliteDestinationAdapter.js):
  // every row a migration inserts is tagged with the migration's id, so `DELETE FROM <table>
  // WHERE source_migration_id = ?` can undo exactly that run and nothing else. Only added to the
  // realistic set of migration-target tables — junction/log/audit/finance tables are never a
  // migration destination, so they don't get this column.
  for (const table of ['colleges', 'departments', 'programs', 'terms', 'rooms', 'courses',
    'users', 'student_profiles', 'teachers', 'teacher_profiles', 'enrollments']) {
    ensureColumn(table, 'source_migration_id', 'INTEGER');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_source_migration_id ON ${table}(source_migration_id)`);
  }
  // The originally-uploaded file's name (e.g. "students.csv"), kept only so CsvConnector/
  // ExcelConnector can name a discovered table after it instead of the opaque server-side storage
  // path (migration-uploads/migration-<id>.csv) — cosmetic, never used for anything security- or
  // logic-relevant. NULL for saved-connection (SQL) sources. Added via ensureColumn, not the
  // CREATE TABLE above, because the `migrations` table may already exist on a running install.
  ensureColumn('migrations', 'sourceFileName', 'TEXT');
  ensureColumn('migration_batches', 'phase', "TEXT NOT NULL DEFAULT 'import'");
  ensureColumn('migration_logs', 'phase', "TEXT NOT NULL DEFAULT 'import'");

  await reportUnassignedCurriculumStudents();
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
  curriculum: ['Activate', 'Archive', 'AssignStudent', 'Compare', 'AuditStudent', 'OverrideRegistrationRecommendation'],
  graduation: ['CandidatesView', 'AuditRun', 'ApplicationReview', 'ApproveDepartment', 'ApproveRegistrar',
    'Finalize', 'RegistryView', 'RegistryExport', 'Correct', 'CertificateManage', 'TranscriptManage', 'ReportsView'],
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

/** Deliberately does NOT backfill student_curriculum — inventing a curriculum assignment for an
    existing student is a grandfathering-rule decision, not a schema concern. Just logs how many
    students currently have none, every startup, so the number stays visible until that rule is
    decided and Phase 2 actually assigns them. */
async function reportUnassignedCurriculumStudents() {
  const row = await get(`
    SELECT COUNT(*) as n FROM users
    WHERE role = 'student' AND id NOT IN (SELECT studentId FROM student_curriculum)
  `);
  console.log(`[curriculum] ${row?.n || 0} existing student(s) have no curriculum assigned (student_curriculum left empty for them — grandfather rule pending).`);
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
    routes/superAdmin.js's system reset). Pass { commit: false } to always roll back even on
    success — used by simulationHarness.js for dry runs; every existing call site omits the
    option and keeps committing on success exactly as before. */
async function transaction(fn, { commit = true } = {}) {
  db.exec('BEGIN');
  try {
    const result = await fn();
    db.exec(commit ? 'COMMIT' : 'ROLLBACK');
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
