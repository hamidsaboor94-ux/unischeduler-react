/**
 * Automatic student semester progression. A student's academic standing lives in two places kept
 * in sync by this module: the append-only `semester_records` ledger (one row per attempt at a
 * semester — never overwritten once completed, so history survives) and a denormalized mirror on
 * `student_profiles` (`programSemester`/`semesterStatus`) that every read site (Student Profile,
 * Student Dashboard) uses without a join.
 *
 * Progression is never date/calendar-driven — it only reacts to the student's actual final
 * grades in the term their currently-open semester is tied to (see evaluateStudentProgression).
 * Nothing here runs on a timer; every write is triggered by an authorized user's action (the
 * evaluate/override endpoints in routes/progression.js), so every automatic or manual change has
 * a real actor to attribute in the audit log.
 */
const { all, get, run, logAudit } = require('./db');
const { computeAcademicSummary } = require('./academicSummary');

const OPEN_STATUSES = ['In Progress', 'Awaiting Results', 'On Hold'];
const VALID_STATUSES = ['In Progress', 'Awaiting Results', 'Passed', 'Failed', 'On Hold', 'Graduation Eligible'];
// How many failed courses in an otherwise-complete semester still allow automatic progression
// (the student carries them as repeats) before the whole semester is blocked as Failed. Admin-
// configurable via PUT /settings/semester-progression-policy; this is only the out-of-the-box
// default. Deliberately > 0 — a single failed course must never be assumed to fail the entire
// semester (that's a per-course outcome, not a semester-wide one) unless the institution says so.
const DEFAULT_MAX_FAILED_FOR_PROGRESSION = 1;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function getMaxFailedCoursesPolicy() {
  const row = await get(`SELECT value FROM settings WHERE key = 'maxFailedCoursesForProgression'`);
  const n = row?.value != null && row.value !== '' ? Number(row.value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_FAILED_FOR_PROGRESSION;
}

async function getActiveTermId() {
  const term = await get('SELECT id FROM terms WHERE isActive = 1 ORDER BY id DESC LIMIT 1');
  return term ? term.id : null;
}

/** The one semester_records row currently open for a student (there is ever at most one), or
    null if — somehow — none exists yet (ensureOpenRecord below always fixes that). */
async function getOpenRecord(studentId) {
  return get(
    `SELECT * FROM semester_records WHERE studentId = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`,
    [studentId, ...OPEN_STATUSES]
  );
}

/** Every semester_records row for a student, most recent attempt first — the full progression
    history the Student Profile / transcript view reads. */
async function getHistory(studentId) {
  return all('SELECT * FROM semester_records WHERE studentId = ? ORDER BY id DESC', [studentId]);
}

/** Every route in this module works against student_profiles, which (unlike users) isn't
    guaranteed to exist yet for a brand-new account depending on which path created it — same
    guard routes/studentProfile.js's ensureProfileRow uses before its own reads/writes. */
async function ensureProfileRow(studentId) {
  await run('INSERT OR IGNORE INTO student_profiles (studentId) VALUES (?)', [studentId]);
}

/** The record a caller should treat as "the student's current one": the open record if one
    exists; otherwise the most recent record regardless of status, whether that's a *brand-new*
    student with no history at all (in which case one is opened at Semester 1) or a student whose
    latest semester ended in a terminal state — Failed or Graduation Eligible — that needs a
    manual decision, not a silently-fabricated new attempt. Only the true "no history yet" case
    creates a row; a terminal record is returned as-is.
    `termIdHint` lets a caller pin a newly-created open record to a specific term instead of
    "whatever's active right now" — needed by the bulk term sweep (evaluateTerm below), which may
    be run against a term that's no longer the active one (the registrar closed it out and moved
    on before getting to run end-of-term evaluation). The single-student endpoints omit the hint,
    so "evaluate me now" still means "against the currently active term". */
async function ensureOpenRecord(studentId, termIdHint) {
  await ensureProfileRow(studentId);
  const existing = await getOpenRecord(studentId);
  if (existing) return existing;
  const latest = await get('SELECT * FROM semester_records WHERE studentId = ? ORDER BY id DESC LIMIT 1', [studentId]);
  if (latest) return latest;
  const profile = await get('SELECT programSemester, semesterStatus FROM student_profiles WHERE studentId = ?', [studentId]);
  const semesterNumber = profile?.programSemester || 1;
  const termId = termIdHint ?? await getActiveTermId();
  const result = await run(
    `INSERT INTO semester_records (studentId, semesterNumber, termId, status) VALUES (?, ?, ?, 'In Progress')`,
    [studentId, semesterNumber, termId]
  );
  await run(`UPDATE student_profiles SET programSemester = ?, semesterStatus = 'In Progress' WHERE studentId = ?`, [semesterNumber, studentId]);
  return get('SELECT * FROM semester_records WHERE id = ?', [result.id]);
}

/** A student's enrolled courses for one term, with their final letter grade (null = not yet
    graded). This — not calendar dates — is what "the semester's results are complete" means. */
async function termCourseRows(studentId, termId) {
  if (!termId) return [];
  return all(
    `SELECT e.grade, c.id as courseId, c.code, c.name, c.credits
     FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE e.studentId = ? AND e.status = 'enrolled' AND c.termId = ?`,
    [studentId, termId]
  );
}

/** Graduation eligibility after passing semester `semesterNumber`: prefers the program's credit
    requirement (cumulative completed credits >= totalCredits) when the program defines one,
    falling back to an explicit numberOfSemesters cap. False (never graduate) if the student has
    no program assigned or the program defines neither signal — auto-graduation needs at least
    one concrete target, never guessed. */
async function resolveGraduationEligibility(studentId, semesterNumber) {
  const profile = await get('SELECT programId FROM student_profiles WHERE studentId = ?', [studentId]);
  if (!profile?.programId) return false;
  const program = await get('SELECT totalCredits, numberOfSemesters FROM programs WHERE id = ?', [profile.programId]);
  if (!program) return false;
  if (program.totalCredits) {
    const summary = await computeAcademicSummary(studentId);
    if (summary.completedCredits >= program.totalCredits) return true;
  }
  if (program.numberOfSemesters && semesterNumber >= program.numberOfSemesters) return true;
  return false;
}

/**
 * Evaluates the student's currently-open semester against their real final grades and, only when
 * every enrolled course in that semester's term has a final letter grade, decides the outcome:
 *  - not all graded yet         -> stays/becomes "Awaiting Results" (never advances on a guess)
 *  - 0 failed courses            -> "Passed", auto-advance to semester N+1 (or Graduation Eligible)
 *  - failed <= policy threshold  -> "Passed" (with the failed course(s) noted as repeats), still
 *                                    auto-advances — failing one course never blocks the semester
 *  - failed > policy threshold   -> "Failed", does NOT advance; needs a manual override to resolve
 * Every branch that changes real data writes an audit_log entry with old/new student_profiles
 * state, even though this is the "automatic" path — `actorUser` is always the real user who
 * triggered the evaluation (there is no unattended/cron trigger in this system).
 */
async function evaluateStudentProgression(studentId, actorUser, { termIdHint } = {}) {
  const record = await ensureOpenRecord(studentId, termIdHint);
  if (!OPEN_STATUSES.includes(record.status)) {
    // Failed / Graduation Eligible — a closed, terminal state. Re-running evaluation can't do
    // anything further; only a manual override (an explicit authorized decision) can move a
    // student past it.
    return {
      studentId, advanced: false, status: record.status, semesterNumber: record.semesterNumber,
      reason: `Semester ${record.semesterNumber} is already ${record.status} — a manual override is required to proceed.`,
    };
  }
  const termId = record.termId;
  const courses = await termCourseRows(studentId, termId);

  if (!courses.length) {
    return { studentId, advanced: false, status: record.status, semesterNumber: record.semesterNumber, reason: 'No enrollments recorded for the current semester yet.' };
  }

  const creditsAttempted = courses.reduce((sum, c) => sum + (c.credits || 0), 0);
  const allGraded = courses.every(c => c.grade != null);

  if (!allGraded) {
    if (record.status !== 'Awaiting Results') {
      const oldProfile = await get('SELECT semesterStatus FROM student_profiles WHERE studentId = ?', [studentId]);
      await run(`UPDATE semester_records SET status = 'Awaiting Results', creditsAttempted = ? WHERE id = ?`, [creditsAttempted, record.id]);
      await run(`UPDATE student_profiles SET semesterStatus = 'Awaiting Results' WHERE studentId = ?`, [studentId]);
      await logAudit(actorUser, 'progress-evaluate', 'student_profiles', studentId,
        { semesterNumber: record.semesterNumber, gradedCount: courses.filter(c => c.grade != null).length, totalCount: courses.length },
        oldProfile, { semesterStatus: 'Awaiting Results' });
    }
    return { studentId, advanced: false, status: 'Awaiting Results', semesterNumber: record.semesterNumber, reason: 'Not all courses have final grades yet.' };
  }

  const failedCourses = courses.filter(c => c.grade === 'F');
  const creditsEarned = courses.filter(c => c.grade !== 'F').reduce((sum, c) => sum + (c.credits || 0), 0);
  const termSummary = await computeAcademicSummary(studentId, { termId });
  const maxAllowed = await getMaxFailedCoursesPolicy();
  const failedCoursesJson = failedCourses.length
    ? JSON.stringify(failedCourses.map(c => ({ courseId: c.courseId, code: c.code, name: c.name })))
    : null;
  const oldProfile = await get('SELECT semesterStatus, enrollmentStatus, programSemester FROM student_profiles WHERE studentId = ?', [studentId]);

  if (failedCourses.length > maxAllowed) {
    const cumulative = await computeAcademicSummary(studentId);
    await run(
      `UPDATE semester_records SET status = 'Failed', creditsAttempted = ?, creditsEarned = ?, termGpa = ?, cgpa = ?, failedCourses = ?, completedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [creditsAttempted, creditsEarned, termSummary.gpa, cumulative.gpa, failedCoursesJson, record.id]
    );
    await run(
      `UPDATE student_profiles SET semesterStatus = 'Failed',
       enrollmentStatus = CASE WHEN enrollmentStatus IN ('Regular', 'Probation') THEN 'Probation' ELSE enrollmentStatus END
       WHERE studentId = ?`,
      [studentId]
    );
    const newProfile = await get('SELECT semesterStatus, enrollmentStatus, programSemester FROM student_profiles WHERE studentId = ?', [studentId]);
    await logAudit(actorUser, 'progress-evaluate', 'student_profiles', studentId,
      { semesterNumber: record.semesterNumber, failedCourses: failedCourses.map(c => c.code), maxAllowed }, oldProfile, newProfile);
    return {
      studentId, advanced: false, status: 'Failed', semesterNumber: record.semesterNumber,
      failedCourses: failedCourses.map(c => c.code),
      reason: `Failed ${failedCourses.length} course(s), exceeding the allowed ${maxAllowed}. Needs a manual decision (repeat/probation/withdrawal).`,
    };
  }

  // Passed — 0 failed courses, or a tolerated number of them (carried forward as repeats).
  const cumulative = await computeAcademicSummary(studentId);
  await run(
    `UPDATE semester_records SET status = 'Passed', creditsAttempted = ?, creditsEarned = ?, termGpa = ?, cgpa = ?, failedCourses = ?, completedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    [creditsAttempted, creditsEarned, termSummary.gpa, cumulative.gpa, failedCoursesJson, record.id]
  );

  const graduationEligible = await resolveGraduationEligibility(studentId, record.semesterNumber);
  let newSemesterNumber = record.semesterNumber;
  let newProfileStatus;

  if (graduationEligible) {
    newProfileStatus = 'Graduation Eligible';
  } else {
    newSemesterNumber = record.semesterNumber + 1;
    const activeTermId = await getActiveTermId();
    const nextTermId = activeTermId && activeTermId !== termId ? activeTermId : null;
    await run(`INSERT INTO semester_records (studentId, semesterNumber, termId, status) VALUES (?, ?, ?, 'In Progress')`,
      [studentId, newSemesterNumber, nextTermId]);
    newProfileStatus = 'In Progress';
  }

  await run(
    `UPDATE student_profiles SET programSemester = ?, semesterStatus = ?,
     enrollmentStatus = CASE WHEN enrollmentStatus IN ('Regular', 'Probation') THEN ? ELSE enrollmentStatus END
     WHERE studentId = ?`,
    [newSemesterNumber, newProfileStatus, failedCourses.length ? 'Probation' : 'Regular', studentId]
  );

  const newProfile = await get('SELECT semesterStatus, enrollmentStatus, programSemester FROM student_profiles WHERE studentId = ?', [studentId]);
  await logAudit(actorUser, 'progress-evaluate', 'student_profiles', studentId,
    { semesterNumber: record.semesterNumber, passed: true, failedCourses: failedCourses.map(c => c.code), graduationEligible }, oldProfile, newProfile);

  return {
    studentId, advanced: !graduationEligible, status: newProfileStatus,
    semesterNumber: newSemesterNumber, previousSemester: record.semesterNumber,
    failedCourses: failedCourses.map(c => c.code), graduationEligible,
  };
}

/** The population a Registrar's "evaluate this term" bulk action should sweep: every student who
    either already has an open semester_records row tied to `termId`, or is actively enrolled in
    a course belonging to it but has never been individually evaluated yet (so has no
    semester_records row for it at all — evaluateStudentProgression's termIdHint below makes sure
    one gets opened against `termId` itself, not whatever term happens to be active right now). */
async function studentsOpenInTerm(termId) {
  const viaRecords = await all(
    `SELECT DISTINCT studentId FROM semester_records WHERE termId = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`,
    [termId, ...OPEN_STATUSES]
  );
  const viaEnrollment = await all(
    `SELECT DISTINCT e.studentId FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE c.termId = ? AND e.status = 'enrolled'`,
    [termId]
  );
  const ids = new Set([...viaRecords.map(r => r.studentId), ...viaEnrollment.map(r => r.studentId)]);
  return [...ids];
}

async function evaluateTerm(termId, actorUser) {
  const studentIds = await studentsOpenInTerm(termId);
  const results = [];
  for (const studentId of studentIds) results.push(await evaluateStudentProgression(studentId, actorUser, { termIdHint: termId }));
  return results;
}

/**
 * Manual override — the only path allowed to set a semester number/status the automatic engine
 * didn't arrive at itself (an academic-committee decision, a data-entry correction, a policy
 * exception). Always requires a non-empty `reason` and always audit-logs it (old/new profile
 * state + the reason + the acting user), per the feature's authorization requirement. Jumping to
 * a different semester number closes the current open record (status 'On Hold', noting who/why)
 * and opens a fresh one at the target semester, so history is never overwritten in place.
 */
async function manualOverride(studentId, { semesterNumber, status, reason, notes }, actorUser) {
  if (!reason || !String(reason).trim()) throw httpError(400, 'A reason is required for a manual override.');
  if (status && !VALID_STATUSES.includes(status)) throw httpError(400, `status must be one of: ${VALID_STATUSES.join(', ')}`);

  const record = await ensureOpenRecord(studentId);
  const oldProfile = await get('SELECT semesterStatus, programSemester FROM student_profiles WHERE studentId = ?', [studentId]);
  const newSemesterNumber = semesterNumber != null ? Number(semesterNumber) : record.semesterNumber;
  if (!Number.isInteger(newSemesterNumber) || newSemesterNumber < 1) throw httpError(400, 'semesterNumber must be a positive whole number.');
  const newStatus = status || record.status;
  const trimmedReason = String(reason).trim();

  if (newSemesterNumber !== record.semesterNumber) {
    await run(
      `UPDATE semester_records SET status = 'On Hold', notes = ?, completedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [`Overridden by ${actorUser.email || actorUser.sub}: ${trimmedReason}`, record.id]
    );
    await run(
      `INSERT INTO semester_records (studentId, semesterNumber, termId, status, notes, createdBy) VALUES (?, ?, ?, ?, ?, ?)`,
      [studentId, newSemesterNumber, record.termId, newStatus, trimmedReason, actorUser.sub]
    );
  } else {
    await run(
      `UPDATE semester_records SET status = ?, notes = ? WHERE id = ?`,
      [newStatus, notes ? `${notes} — ${trimmedReason}` : trimmedReason, record.id]
    );
  }

  await run(`UPDATE student_profiles SET programSemester = ?, semesterStatus = ? WHERE studentId = ?`, [newSemesterNumber, newStatus, studentId]);
  const newProfile = await get('SELECT semesterStatus, programSemester FROM student_profiles WHERE studentId = ?', [studentId]);
  await logAudit(actorUser, 'progress-override', 'student_profiles', studentId, { reason: trimmedReason }, oldProfile, newProfile);

  return get('SELECT * FROM student_profiles WHERE studentId = ?', [studentId]);
}

module.exports = {
  OPEN_STATUSES, VALID_STATUSES, DEFAULT_MAX_FAILED_FOR_PROGRESSION,
  getMaxFailedCoursesPolicy, getOpenRecord, getHistory, ensureOpenRecord, termCourseRows,
  resolveGraduationEligibility, evaluateStudentProgression, evaluateTerm, manualOverride,
};
