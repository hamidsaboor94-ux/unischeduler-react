/**
 * Prerequisite-based course eligibility — the single source of truth for whether a student may
 * enroll in a course. Reused by both the enroll endpoints (routes/enrollments.js, live per-course
 * checks) and the student catalog (routes/students.js's GET /me/eligible-courses, one batched
 * pass over every course). The actual gating decision lives in computeRowEligibility(); the two
 * call sites differ only in how they gather its inputs (live queries vs. one prefetch), so the
 * rules themselves can never drift between "what the catalog shows" and "what enrollment allows."
 *
 * "One logical course" — sections and term-reofferings are separate `courses` rows (see
 * routes/enrollments.js's sibling-section comment / utils.js's groupCourseSections on the
 * frontend) that share the same (trimmed, case-insensitive) name. Every completion/duplicate
 * check here groups by that name across ALL terms (a "family") rather than by a single course id,
 * so a student who passed one section/offering of a course is credited for every other one.
 */
const { all, get } = require('./db');
const { getGradingScale } = require('./gradingScale');
const { hasScheduleClash } = require('./enrollmentChecks');
const { hasFinancialHold } = require('./finance');
const { overlapsMinutes } = require('./scheduling');

function familyKey(name) {
  return String(name || '').trim().toLowerCase();
}

async function getActiveTerm() {
  return get('SELECT * FROM terms WHERE isActive = 1 ORDER BY id DESC LIMIT 1');
}

/** Every course row sharing `courseId`'s (trimmed, case-insensitive) name, across all terms. */
async function courseFamilyIds(courseId) {
  const course = await get('SELECT id, name FROM courses WHERE id = ?', [courseId]);
  if (!course) return [];
  const rows = await all('SELECT id FROM courses WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [course.name]);
  return rows.map(r => r.id);
}

/** 'passed' wins over everything else (once passed, always credited — retaking for a better grade
    is a separate, not-yet-built workflow per the spec, not modeled here). Then 'in-progress'
    (enrolled, ungraded — does NOT satisfy a plain prerequisite, only a corequisite). Then 'failed'
    (enrolled with a non-passing grade). Then 'withdrawn' (soft-deleted, status='dropped' or the
    post-deadline 'withdrawn' — either way, no credit toward the prerequisite, retake required). */
function familyStatusFromRows(rows, isPassing) {
  if (rows.some(r => r.status === 'enrolled' && isPassing(r.grade))) return 'passed';
  if (rows.some(r => r.status === 'enrolled' && r.grade == null)) return 'in-progress';
  if (rows.some(r => r.status === 'enrolled' && r.grade != null)) return 'failed';
  if (rows.some(r => r.status === 'dropped' || r.status === 'withdrawn')) return 'withdrawn';
  return 'none';
}

async function isPassingGradeFn() {
  const scale = await getGradingScale();
  return (grade) => grade != null && scale.some(b => b.label === grade && b.point > 0);
}

async function familyCompletionStatus(studentId, courseId) {
  const familyIds = await courseFamilyIds(courseId);
  if (!familyIds.length) return 'none';
  const rows = await all(
    `SELECT status, grade FROM enrollments WHERE studentId = ? AND courseId IN (${familyIds.map(() => '?').join(',')})`,
    [studentId, ...familyIds]
  );
  const isPassing = await isPassingGradeFn();
  return familyStatusFromRows(rows, isPassing);
}

/** Groups `course_prerequisites` rows into AND-of-OR requirements: rows with `groupId == null`
    are each their own required (AND) requirement; rows sharing the same non-null `groupId` form
    one OR requirement (satisfying any one option satisfies it). `statusFor(prerequisiteCourseId)`
    resolves that prerequisite's family completion status. */
function buildRequirements(prereqRows, statusFor) {
  const groups = new Map();
  for (const row of prereqRows) {
    const key = row.groupId != null ? `g:${row.groupId}` : `s:${row.prerequisiteCourseId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const requirements = [...groups.values()].map(options => {
    const evaluated = options.map(o => {
      const status = statusFor(o.prerequisiteCourseId);
      // A corequisite may be satisfied by concurrent (in-progress) enrollment, not just having
      // already passed it — a true prerequisite needs an actual completed pass.
      const completed = o.type === 'corequisite' ? (status === 'passed' || status === 'in-progress') : status === 'passed';
      return { courseId: o.prerequisiteCourseId, courseCode: o.code, courseName: o.name, type: o.type || 'prerequisite', completed };
    });
    return { satisfied: evaluated.some(o => o.completed), options: evaluated };
  });
  return { satisfied: requirements.every(r => r.satisfied), requirements };
}

async function evaluatePrerequisites(studentId, courseId) {
  const rows = await all(
    `SELECT cp.prerequisiteCourseId, cp.groupId, cp.type, c.code, c.name
     FROM course_prerequisites cp JOIN courses c ON c.id = cp.prerequisiteCourseId
     WHERE cp.courseId = ?`,
    [courseId]
  );
  if (!rows.length) return { satisfied: true, requirements: [] };
  const statusByPrereqId = new Map();
  for (const row of rows) {
    if (!statusByPrereqId.has(row.prerequisiteCourseId)) {
      // eslint-disable-next-line no-await-in-loop
      statusByPrereqId.set(row.prerequisiteCourseId, await familyCompletionStatus(studentId, row.prerequisiteCourseId));
    }
  }
  return buildRequirements(rows, id => statusByPrereqId.get(id));
}

/** Course codes still missing, flattened across every unsatisfied requirement — the flat
    array-of-codes shape the staff enroll/bulk-enroll warning UI already expects (predates the
    richer `requirements` structure the student catalog uses). */
function missingPrerequisiteCodes(prereqResult) {
  const codes = new Set();
  for (const r of prereqResult.requirements) {
    if (r.satisfied) continue;
    for (const o of r.options) codes.add(o.courseCode);
  }
  return [...codes];
}

function missingPrerequisiteObjects(prereqResult) {
  const seen = new Set();
  const out = [];
  for (const r of prereqResult.requirements) {
    if (r.satisfied) continue;
    for (const o of r.options) {
      if (seen.has(o.courseId)) continue;
      seen.add(o.courseId);
      out.push({ courseId: o.courseId, courseCode: o.courseCode, courseName: o.courseName });
    }
  }
  return out;
}

/** True if adding "courseId requires prerequisiteCourseId" would close a cycle — i.e.
    prerequisiteCourseId (transitively, via existing edges) already requires courseId. Operates on
    course *families* (by name) so a cycle routed through a sibling section is still caught. */
async function wouldCreateCycle(courseId, prerequisiteCourseId) {
  const courses = await all('SELECT id, name FROM courses');
  const nameById = new Map(courses.map(c => [c.id, familyKey(c.name)]));
  const startFamily = nameById.get(Number(prerequisiteCourseId));
  const targetFamily = nameById.get(Number(courseId));
  if (!startFamily || !targetFamily) return false;
  if (startFamily === targetFamily) return true;

  const edges = await all('SELECT courseId, prerequisiteCourseId FROM course_prerequisites');
  const adj = new Map();
  for (const e of edges) {
    const from = nameById.get(e.courseId);
    const to = nameById.get(e.prerequisiteCourseId);
    if (!from || !to) continue;
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from).add(to);
  }

  const visited = new Set([startFamily]);
  const queue = [startFamily];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj.get(cur) || []) {
      if (next === targetFamily) return true;
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return false;
}

/**
 * The actual gating decision, pure and DB-free — both evaluateEligibility (live, per-course) and
 * getEligibleCatalog (batched, whole-catalog) build this same input shape and call this. Capacity
 * is deliberately NOT a blocker: a full course already lets a student join the waitlist (see
 * routes/enrollments.js's existing 'waitlisted' status and CourseDetailModal's "Join Waitlist"
 * button) — treating it as ineligible here would regress that feature. "Enrollment restriction"
 * from the spec has no dedicated entity in this schema; it's covered by the active/program/
 * department/term gates below rather than an invented, unused table.
 */
function computeRowEligibility({
  studentActive, programMismatch, departmentMismatch, offeredThisTerm, familyStatus,
  alreadyEnrolledOrWaitlisted, siblingCode, prereqResult, scheduleClash, creditIssueMessage,
  financialHold, maxStudents, enrolledCount,
}) {
  const blocking = [];
  if (!studentActive) blocking.push({ code: 'inactive', message: 'Your student status does not permit enrollment.' });
  if (programMismatch) blocking.push({ code: 'wrong-program', message: 'This course is not offered in your program.' });
  if (departmentMismatch) blocking.push({ code: 'wrong-department', message: 'This course is not offered in your department.' });
  if (offeredThisTerm === false) blocking.push({ code: 'not-offered', message: 'This course is not offered this term.' });
  if (familyStatus === 'passed') blocking.push({ code: 'already-completed', message: 'You have already completed this course.' });
  if (alreadyEnrolledOrWaitlisted) {
    blocking.push({
      code: 'already-enrolled',
      message: siblingCode
        ? `You're already enrolled in another section of this course (${siblingCode}) this term.`
        : 'Already enrolled or waitlisted in this course',
    });
  }
  if (!prereqResult.satisfied) {
    blocking.push({ code: 'missing-prerequisite', message: `Missing prerequisite: ${missingPrerequisiteCodes(prereqResult).join(', ')}` });
  }
  if (scheduleClash) blocking.push({ code: 'schedule-clash', message: 'This course conflicts with a time slot already on your schedule' });
  if (creditIssueMessage) blocking.push({ code: 'credit-limit', message: creditIssueMessage });
  if (financialHold) blocking.push({ code: 'financial-hold', message: 'You have an outstanding balance that must be cleared before enrolling in new courses.' });

  const willWaitlist = maxStudents != null && enrolledCount >= maxStudents;
  return {
    eligible: blocking.length === 0,
    blocking,
    reason: blocking[0]?.message || null,
    willWaitlist,
    prerequisites: prereqResult.requirements,
    missingPrerequisites: missingPrerequisiteObjects(prereqResult),
  };
}

/** Live, per-course eligibility check — used at enroll time (routes/enrollments.js). Also
    surfaces `prereqIssues` (flat course-code array) and `scheduleClash` (boolean) for the
    existing staff-enroll warning/override flow, which predates and doesn't need the richer
    `prerequisites`/`blocking` shape. */
async function evaluateEligibility(studentId, courseId) {
  const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (!course) {
    return { eligible: false, blocking: [{ code: 'not-found', message: 'Course not found' }], reason: 'Course not found', willWaitlist: false, prerequisites: [], missingPrerequisites: [], prereqIssues: [], scheduleClash: false };
  }

  const profile = await get('SELECT * FROM student_profiles WHERE studentId = ?', [studentId]);
  const activeTerm = await getActiveTerm();

  const familyStatus = await familyCompletionStatus(studentId, courseId);

  const already = await get(
    `SELECT id FROM enrollments WHERE studentId = ? AND courseId = ? AND status IN ('enrolled', 'waitlisted')`,
    [studentId, courseId]
  );
  const sibling = await get(
    `SELECT c2.code FROM enrollments e JOIN courses c2 ON c2.id = e.courseId
     WHERE e.studentId = ? AND e.status IN ('enrolled', 'waitlisted') AND e.courseId != ?
       AND c2.termId IS ? AND LOWER(TRIM(c2.name)) = LOWER(TRIM(?))`,
    [studentId, courseId, course.termId ?? null, course.name]
  );

  const prereqResult = await evaluatePrerequisites(studentId, courseId);
  const scheduleClash = await hasScheduleClash(studentId, courseId, course.termId);

  let creditIssueMessage = null;
  if (course.termId) {
    const term = await get('SELECT * FROM terms WHERE id = ?', [course.termId]);
    if (term && term.creditLimit != null) {
      const enrolledCourses = await all(
        `SELECT c.credits FROM enrollments e JOIN courses c ON c.id = e.courseId
         WHERE e.studentId = ? AND e.status = 'enrolled' AND c.termId = ?`,
        [studentId, course.termId]
      );
      const currentCredits = enrolledCourses.reduce((sum, r) => sum + (r.credits || 0), 0);
      if (currentCredits + (course.credits || 0) > term.creditLimit) {
        creditIssueMessage = `This would exceed your ${term.creditLimit}-credit limit for ${term.name} — you currently have ${currentCredits} credits enrolled.`;
      }
    }
  }

  const financialHold = await hasFinancialHold(studentId);
  const enrolledCountRow = await get(`SELECT COUNT(*) as n FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [courseId]);

  const result = computeRowEligibility({
    studentActive: !profile || !profile.studentStatus || profile.studentStatus === 'Active',
    programMismatch: profile?.programId != null && course.programId != null && Number(profile.programId) !== Number(course.programId),
    departmentMismatch: profile?.departmentId != null && course.departmentId != null && Number(profile.departmentId) !== Number(course.departmentId),
    offeredThisTerm: course.termId != null && activeTerm ? Number(course.termId) === Number(activeTerm.id) : null,
    familyStatus,
    alreadyEnrolledOrWaitlisted: !!already || !!sibling,
    siblingCode: sibling ? sibling.code : null,
    prereqResult,
    scheduleClash,
    creditIssueMessage,
    financialHold,
    maxStudents: course.maxStudents,
    enrolledCount: enrolledCountRow.n,
  });

  return { ...result, prereqIssues: missingPrerequisiteCodes(prereqResult), scheduleClash };
}

/**
 * Batched catalog for GET /students/me/eligible-courses — one query per table, everything else
 * computed in memory, so this stays fast regardless of catalog size. Buckets every course family
 * into exactly one of: completed (passed, any term), currentlyEnrolled, notOffered (no row in the
 * current term), eligible, notYetEligible — mirroring evaluateEligibility's same rules via the
 * same computeRowEligibility() so the catalog can never show a course as eligible that the enroll
 * endpoint would then reject.
 */
async function getEligibleCatalog(studentId) {
  const [profile, activeTerm, courses, enrollmentRows, prereqRows, scale] = await Promise.all([
    get('SELECT * FROM student_profiles WHERE studentId = ?', [studentId]),
    getActiveTerm(),
    all('SELECT * FROM courses'),
    all(
      `SELECT e.*, c.name as courseName, c.termId as courseTermId FROM enrollments e
       JOIN courses c ON c.id = e.courseId WHERE e.studentId = ?`,
      [studentId]
    ),
    all(
      `SELECT cp.courseId, cp.prerequisiteCourseId, cp.groupId, cp.type, c.code, c.name
       FROM course_prerequisites cp JOIN courses c ON c.id = cp.prerequisiteCourseId`
    ),
    getGradingScale(),
  ]);
  const isPassing = (grade) => grade != null && scale.some(b => b.label === grade && b.point > 0);
  const financialHold = await hasFinancialHold(studentId);

  const familiesByKey = new Map();
  const familyKeyByCourseId = new Map();
  for (const c of courses) {
    const key = familyKey(c.name);
    familyKeyByCourseId.set(c.id, key);
    if (!familiesByKey.has(key)) familiesByKey.set(key, []);
    familiesByKey.get(key).push(c);
  }

  const enrollmentsByFamily = new Map();
  const enrollmentByCourseId = new Map();
  for (const e of enrollmentRows) {
    const key = familyKeyByCourseId.get(e.courseId) ?? familyKey(e.courseName);
    if (!enrollmentsByFamily.has(key)) enrollmentsByFamily.set(key, []);
    enrollmentsByFamily.get(key).push(e);
    if (e.status === 'enrolled' || e.status === 'waitlisted') enrollmentByCourseId.set(e.courseId, e);
  }
  const familyStatus = (key) => familyStatusFromRows(enrollmentsByFamily.get(key) || [], isPassing);

  const prereqsByCourseId = new Map();
  for (const row of prereqRows) {
    if (!prereqsByCourseId.has(row.courseId)) prereqsByCourseId.set(row.courseId, []);
    prereqsByCourseId.get(row.courseId).push(row);
  }
  const prereqResultFor = (courseId) => {
    const rows = prereqsByCourseId.get(courseId) || [];
    if (!rows.length) return { satisfied: true, requirements: [] };
    return buildRequirements(rows, id => familyStatus(familyKeyByCourseId.get(id)));
  };

  const enrolledCountRows = await all(`SELECT courseId, COUNT(*) as n FROM enrollments WHERE status = 'enrolled' GROUP BY courseId`);
  const enrolledCountByCourseId = new Map(enrolledCountRows.map(r => [r.courseId, r.n]));

  // Batched schedule-clash check: one query for every current-term course's slots, one for the
  // student's own current-term enrolled slots, then an in-memory overlap check per candidate
  // (mirrors enrollmentChecks.js's hasScheduleClash exactly, without a query per course row).
  const currentTermCourseIds = courses
    .filter(c => c.termId == null || (activeTerm && Number(c.termId) === Number(activeTerm.id)))
    .map(c => c.id);
  const currentTermSlots = currentTermCourseIds.length
    ? await all(`SELECT * FROM timetable_slots WHERE courseId IN (${currentTermCourseIds.map(() => '?').join(',')})`, currentTermCourseIds)
    : [];
  const slotsByCourseId = new Map();
  for (const s of currentTermSlots) {
    if (!slotsByCourseId.has(s.courseId)) slotsByCourseId.set(s.courseId, []);
    slotsByCourseId.get(s.courseId).push(s);
  }
  const myEnrolledCourseIdsThisTerm = new Set(
    enrollmentRows.filter(e => e.status === 'enrolled' && activeTerm && e.courseTermId === activeTerm.id).map(e => e.courseId)
  );
  const myExistingSlots = [...myEnrolledCourseIdsThisTerm].flatMap(cid => (slotsByCourseId.get(cid) || []).map(s => ({ ...s, courseId: cid })));
  const scheduleClashFor = (courseId) => {
    const targetSlots = slotsByCourseId.get(courseId) || [];
    if (!targetSlots.length) return false;
    return targetSlots.some(ts => myExistingSlots.some(es => es.courseId !== courseId && es.day === ts.day
      && overlapsMinutes(es.time, es.durationMinutes || 60, ts.time, ts.durationMinutes || 60)));
  };

  const currentCredits = activeTerm && activeTerm.creditLimit != null
    ? [...myEnrolledCourseIdsThisTerm].reduce((sum, cid) => sum + (courses.find(c => c.id === cid)?.credits || 0), 0)
    : 0;

  const studentActive = !profile || !profile.studentStatus || profile.studentStatus === 'Active';

  const eligible = [], currentlyEnrolled = [], completed = [], notYetEligible = [], notOffered = [];

  for (const [key, familyCourses] of familiesByKey) {
    const status = familyStatus(key);
    if (status === 'passed') {
      const rep = [...familyCourses].sort((a, b) => (b.termId || 0) - (a.termId || 0))[0];
      const passingRow = (enrollmentsByFamily.get(key) || []).find(r => r.status === 'enrolled' && isPassing(r.grade));
      completed.push({ courseId: rep.id, courseCode: rep.code, courseName: rep.name, credits: rep.credits, grade: passingRow?.grade ?? null });
      continue;
    }

    // A course with no termId at all is always considered offered (same fails-open rule
    // evaluateEligibility uses) — only a course whose termId is set to something OTHER than the
    // active term is "not offered this term".
    const currentTermCourses = familyCourses.filter(c => c.termId == null || (activeTerm && Number(c.termId) === Number(activeTerm.id)));
    if (!currentTermCourses.length) {
      const rep = [...familyCourses].sort((a, b) => (b.termId || 0) - (a.termId || 0))[0];
      notOffered.push({ courseId: rep.id, courseCode: rep.code, courseName: rep.name, credits: rep.credits, departmentId: rep.departmentId });
      continue;
    }

    for (const course of currentTermCourses) {
      const myRow = enrollmentByCourseId.get(course.id);
      if (myRow) {
        currentlyEnrolled.push({
          courseId: course.id, courseCode: course.code, courseName: course.name, credits: course.credits,
          enrollmentStatus: myRow.status, grade: myRow.grade,
        });
        continue;
      }

      const siblingCourse = currentTermCourses.find(c => c.id !== course.id && enrollmentByCourseId.has(c.id));
      const prereqResult = prereqResultFor(course.id);
      // Matches evaluateEligibility's own `if (course.termId) { ... }` guard — a termless course
      // never counted toward (or was blocked by) the term credit cap there either.
      let creditIssueMessage = null;
      if (course.termId && activeTerm?.creditLimit != null && currentCredits + (course.credits || 0) > activeTerm.creditLimit) {
        creditIssueMessage = `This would exceed your ${activeTerm.creditLimit}-credit limit for ${activeTerm.name} — you currently have ${currentCredits} credits enrolled.`;
      }

      const result = computeRowEligibility({
        studentActive,
        programMismatch: profile?.programId != null && course.programId != null && Number(profile.programId) !== Number(course.programId),
        departmentMismatch: profile?.departmentId != null && course.departmentId != null && Number(profile.departmentId) !== Number(course.departmentId),
        offeredThisTerm: true,
        familyStatus: status,
        alreadyEnrolledOrWaitlisted: !!siblingCourse,
        siblingCode: siblingCourse ? siblingCourse.code : null,
        prereqResult,
        scheduleClash: siblingCourse ? false : scheduleClashFor(course.id),
        creditIssueMessage,
        financialHold,
        maxStudents: course.maxStudents,
        enrolledCount: enrolledCountByCourseId.get(course.id) || 0,
      });

      const entry = {
        courseId: course.id, courseCode: course.code, courseName: course.name, credits: course.credits,
        departmentId: course.departmentId, programId: course.programId, termId: course.termId,
        availableSeats: course.maxStudents != null ? Math.max(0, course.maxStudents - (enrolledCountByCourseId.get(course.id) || 0)) : null,
        willWaitlist: result.willWaitlist,
        prerequisites: result.prerequisites,
      };
      if (result.eligible) eligible.push(entry);
      else notYetEligible.push({ ...entry, reason: result.reason, blocking: result.blocking, missingPrerequisites: result.missingPrerequisites });
    }
  }

  return { eligible, currentlyEnrolled, completed, notYetEligible, notOffered };
}

module.exports = {
  courseFamilyIds, familyCompletionStatus, evaluatePrerequisites, missingPrerequisiteCodes,
  missingPrerequisiteObjects, wouldCreateCycle, evaluateEligibility, getEligibleCatalog, getActiveTerm,
};
