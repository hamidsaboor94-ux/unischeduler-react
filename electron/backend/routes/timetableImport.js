const express = require('express');
const multer = require('multer');
const { all, get, run, findUserByEmail, logAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { parseTimetablePdf } = require('../pdfTimetableParser');
const { loadTermData } = require('../loaders');
const { computeConflicts } = require('../scheduling');
const { createAccountWithTempPassword } = require('../accounts');
const { isValidEmail } = require('../validate');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const VALID_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// "New Teacher" is a placeholder used in real timetable PDFs for a slot whose real
// instructor hasn't been assigned yet — it must never become an actual account.
const PLACEHOLDER_TEACHER_RE = /^new\s+teacher$/i;
// Login domain for auto-created faculty accounts — these are login IDs, not real
// deliverable addresses (email sending is off), but the domain is still admin-
// configurable per import (via the confirm request) with this as the default.
const DEFAULT_EMAIL_DOMAIN = process.env.FACULTY_EMAIL_DOMAIN || 'faculty.local';
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isPlaceholderTeacher(name) {
  return PLACEHOLDER_TEACHER_RE.test((name || '').trim());
}

/** "Dr. Jamshid Kazimi" -> "jamshid.kazimi" — first + last word, titles stripped, punctuation removed. */
function emailLocalPart(name) {
  const cleaned = name.replace(/^(dr|mr|mrs|ms|prof|eng)\.?\s+/i, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean).map(p => p.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
  if (!parts.length) return 'teacher';
  return parts.length === 1 ? parts[0] : `${parts[0]}.${parts[parts.length - 1]}`;
}

/** Generates a login email for a new faculty account, honoring an admin-edited preview value if one was given and is actually usable, and otherwise deriving one from the name — falling back to a numbered suffix on collision (checked against both the DB and any other new accounts created earlier in this same batch). */
async function resolveFacultyEmail(name, domain, preferredEmail, takenEmails) {
  if (preferredEmail && isValidEmail(preferredEmail) && !takenEmails.has(preferredEmail.toLowerCase())) {
    const existing = await findUserByEmail(preferredEmail);
    if (!existing) {
      const email = preferredEmail.toLowerCase();
      takenEmails.add(email);
      return email;
    }
  }
  const base = emailLocalPart(name);
  let n = 1;
  while (true) {
    const candidate = `${base}${n > 1 ? n : ''}@${domain}`.toLowerCase();
    if (!takenEmails.has(candidate) && !(await findUserByEmail(candidate))) {
      takenEmails.add(candidate);
      return candidate;
    }
    n++;
  }
}

router.post('/parse', requireAuth, requireRole('admin'), upload.single('pdf'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded (expected multipart field "pdf").' });
  let result;
  try {
    result = await parseTimetablePdf(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `Could not read this PDF: ${err.message}` });
  }
  res.json({ ...result, defaultEmailDomain: DEFAULT_EMAIL_DOMAIN });
}));

/** Re-validates a (possibly admin-edited) preview row independently of the client's own `valid` flag. */
function validateRow(row) {
  if (!row.courseName || !row.courseName.trim()) return 'Course name is required.';
  if (!row.day || !VALID_DAYS.includes(row.day)) return `Day must be one of: ${VALID_DAYS.join(', ')}.`;
  if (!row.startTime || !TIME_RE.test(row.startTime)) return 'Start time must be in HH:MM (24h) format.';
  if (!row.endTime || !TIME_RE.test(row.endTime)) return 'End time must be in HH:MM (24h) format.';
  if (TIME_RE.test(row.startTime) && TIME_RE.test(row.endTime) && timeToMinutes(row.endTime) <= timeToMinutes(row.startTime)) {
    return 'End time must be after start time.';
  }
  const semester = Number(row.programSemester);
  if (!Number.isInteger(semester) || semester < 1 || semester > 8) return 'Program semester must be an integer between 1 and 8.';
  if (!row.section || !String(row.section).trim()) return 'Section is required.';
  return null;
}

/** Derives a short, term-unique course code from a name (e.g. "History of Afghanistan" -> "HOA"), since the PDF has no course codes of its own. */
function makeCourseCode(name, existingCodes) {
  const initials = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 8) || 'CRS';
  let code = initials;
  let n = 2;
  while (existingCodes.has(code)) { code = `${initials}${n}`; n++; }
  existingCodes.add(code);
  return code;
}

router.post('/confirm', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { termId, rows } = req.body;
  if (!termId) return res.status(400).json({ error: 'termId is required' });
  const term = await get('SELECT * FROM terms WHERE id = ?', [termId]);
  if (!term) return res.status(404).json({ error: 'Term not found' });
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided' });

  // The PDF itself never contains a department — the admin picks one in the import preview so
  // every class this batch creates is filed under it from the start, instead of landing with no
  // department (like every earlier import did, before this was collected).
  let departmentId = null;
  if (req.body.departmentId !== undefined && req.body.departmentId !== null && req.body.departmentId !== '') {
    departmentId = Number(req.body.departmentId);
    const dept = await get('SELECT id FROM departments WHERE id = ?', [departmentId]);
    if (!dept) return res.status(400).json({ error: 'Selected department does not exist.' });
  }

  let emailDomain = String(req.body.emailDomain || '').trim().toLowerCase();
  if (emailDomain && !DOMAIN_RE.test(emailDomain)) {
    return res.status(400).json({ error: 'emailDomain must look like a real domain, e.g. university.edu' });
  }
  if (!emailDomain) emailDomain = DEFAULT_EMAIL_DOMAIN;
  const lecturerEmails = req.body.lecturerEmails && typeof req.body.lecturerEmails === 'object' ? req.body.lecturerEmails : {};

  const teachers = await all('SELECT id, name, userId FROM teachers');
  const rooms = await all('SELECT id, name FROM rooms');
  const courses = await all('SELECT id, name, teacherId, departmentId FROM courses WHERE termId = ?', [termId]);
  const existingCodes = new Set((await all('SELECT code FROM courses WHERE termId = ?', [termId])).map(c => c.code));

  // Guards against re-running the same (or an overlapping) import creating duplicate slots — the
  // same course/day/time/room/semester/section pair is the same class, whether it came from this
  // batch or an earlier one. Seeded from what's already in the term, then grown as this batch inserts.
  const slotKey = (courseId, day, time, roomId, programSemester, section, durationMinutes) =>
    `${courseId}|${day}|${time}|${roomId ?? ''}|${programSemester}|${section}|${durationMinutes}`;
  const existingSlots = await all('SELECT courseId, day, time, roomId, programSemester, section, durationMinutes FROM timetable_slots WHERE termId = ?', [termId]);
  const seenSlotKeys = new Set(existingSlots.map(s => slotKey(s.courseId, s.day, s.time, s.roomId, s.programSemester, s.section, s.durationMinutes)));

  const byName = (list) => new Map(list.map(x => [x.name.trim().toLowerCase(), x]));
  const teacherByName = byName(teachers);
  const roomByName = byName(rooms);
  // Courses are matched by (name, teacher): the same course name is often taught by a
  // different teacher per section in these documents, and teacher lives on the course
  // record (not the slot) in this schema, so collapsing purely by name would silently
  // overwrite one section's instructor with another's. Same name + same teacher across
  // multiple meeting days correctly reuses one course row with several slots.
  const courseByKey = new Map(courses.map(c => [`${c.name.trim().toLowerCase()}|${c.teacherId ?? ''}`, c]));

  const created = { courses: 0, teachers: 0, rooms: 0, slots: 0, facultyAccounts: 0 };
  const errors = [];
  const facultyAccountsCreated = [];
  const takenEmails = new Set();
  const skippedDuplicates = [];
  let needsTeacherAssignment = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;
    const err = validateRow(row);
    if (err) { errors.push({ row: rowNum, error: err }); continue; }

    let teacherId = null;
    const teacherRaw = (row.teacher || '').trim();
    if (!teacherRaw || isPlaceholderTeacher(teacherRaw)) {
      // Blank, or the "New Teacher" placeholder — never becomes an account; the class
      // still gets created with no instructor, flagged for the admin to assign later.
      needsTeacherAssignment++;
    } else {
      const key = teacherRaw.toLowerCase();
      const existing = teacherByName.get(key);
      if (existing && existing.userId) {
        teacherId = existing.id;
      } else if (existing) {
        // A teacher record exists but was never given a login — back-fill an account
        // now via the same account-creation path used everywhere else in the app.
        const email = await resolveFacultyEmail(existing.name, emailDomain, lecturerEmails[teacherRaw], takenEmails);
        const account = await createAccountWithTempPassword({ name: existing.name, email, role: 'faculty', teacherId: existing.id });
        teacherId = existing.id;
        existing.userId = account.id; // so a later row for the same name reuses it instead of re-creating
        facultyAccountsCreated.push({ name: existing.name, email, role: 'faculty', tempPassword: account.tempPassword });
        created.facultyAccounts++;
      } else {
        // Brand new lecturer — create the teacher record and its login together.
        const email = await resolveFacultyEmail(teacherRaw, emailDomain, lecturerEmails[teacherRaw], takenEmails);
        const account = await createAccountWithTempPassword({ name: teacherRaw, email, role: 'faculty' });
        teacherId = account.teacherId;
        teacherByName.set(key, { id: account.teacherId, name: teacherRaw, userId: account.id });
        facultyAccountsCreated.push({ name: teacherRaw, email, role: 'faculty', tempPassword: account.tempPassword });
        created.teachers++;
        created.facultyAccounts++;
      }
    }

    let roomId = null;
    if (row.room && row.room.trim()) {
      const key = row.room.trim().toLowerCase();
      const existing = roomByName.get(key);
      if (existing) roomId = existing.id;
      else {
        const type = /^lab/i.test(row.room.trim()) ? 'Lab' : null;
        const result = await run('INSERT INTO rooms (name, type) VALUES (?, ?)', [row.room.trim(), type]);
        roomId = result.id;
        roomByName.set(key, { id: roomId, name: row.room.trim() });
        created.rooms++;
      }
    }

    const courseKey = `${row.courseName.trim().toLowerCase()}|${teacherId ?? ''}`;
    let courseId;
    const existingCourse = courseByKey.get(courseKey);
    if (existingCourse) {
      courseId = existingCourse.id;
      // Backfill a department onto a course this batch reuses only if it didn't already have
      // one — never silently overwrite a department someone already set.
      if (departmentId && !existingCourse.departmentId) {
        await run('UPDATE courses SET departmentId = ? WHERE id = ?', [departmentId, courseId]);
        existingCourse.departmentId = departmentId;
      }
    } else {
      const credits = row.credits !== undefined && row.credits !== null && row.credits !== '' ? Number(row.credits) : null;
      const code = makeCourseCode(row.courseName.trim(), existingCodes);
      const result = await run(
        'INSERT INTO courses (code, name, credits, teacherId, roomId, termId, departmentId) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [code, row.courseName.trim(), credits, teacherId, roomId, termId, departmentId]
      );
      courseId = result.id;
      courseByKey.set(courseKey, { id: courseId, name: row.courseName.trim(), teacherId, departmentId });
      created.courses++;
    }

    const durationMinutes = timeToMinutes(row.endTime) - timeToMinutes(row.startTime);
    const programSemester = Number(row.programSemester);
    const section = String(row.section).trim();
    const key = slotKey(courseId, row.day, row.startTime, roomId, programSemester, section, durationMinutes);
    if (seenSlotKeys.has(key)) {
      skippedDuplicates.push({ row: rowNum, courseName: row.courseName.trim(), day: row.day, time: row.startTime, section, programSemester });
      continue;
    }
    seenSlotKeys.add(key);
    await run(
      `INSERT INTO timetable_slots (courseId, day, time, durationMinutes, roomId, termId, programSemester, section)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [courseId, row.day, row.startTime, durationMinutes, roomId, termId, programSemester, section]
    );
    created.slots++;
  }

  if (created.slots) {
    await logAudit(req.user, 'pdf-import', 'timetable_slots', null, { termId, ...created, errorCount: errors.length, duplicatesSkipped: skippedDuplicates.length });
  }
  if (facultyAccountsCreated.length) {
    await logAudit(req.user, 'pdf-import-faculty', 'users', null, {
      termId, count: facultyAccountsCreated.length, emails: facultyAccountsCreated.map(a => a.email)
    });
  }

  const data = await loadTermData(termId);
  const conflicts = computeConflicts(data);

  res.status(200).json({ created, errors, conflicts, facultyAccountsCreated, needsTeacherAssignment, skippedDuplicates });
}));

/**
 * Testing/re-import aid: clears timetable slots for one program semester (all of its sections) within a
 * term, so a PDF can be re-imported repeatedly without piling up duplicates. By default this touches ONLY
 * timetable_slots — courses, rooms, teachers, and every other semester are left alone. Pass `deep: true` to
 * also remove courses that end up completely unused as a result (and, in turn, any teacher record that
 * becomes unused AND was never given a login) — but a course with real enrollments or exams is never
 * touched, deep or not, since those aren't "import test data" anymore.
 */
router.post('/reset', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { termId, deep } = req.body;
  if (!termId) return res.status(400).json({ error: 'termId is required' });
  const term = await get('SELECT id FROM terms WHERE id = ?', [termId]);
  if (!term) return res.status(404).json({ error: 'Term not found' });

  const programSemester = req.body.programSemester === null || req.body.programSemester === undefined
    ? null : Number(req.body.programSemester);
  if (programSemester !== null && (!Number.isInteger(programSemester) || programSemester < 1 || programSemester > 8)) {
    return res.status(400).json({ error: 'programSemester must be an integer between 1 and 8, or null for slots with no semester set.' });
  }

  const semesterClause = programSemester === null ? 'programSemester IS NULL' : 'programSemester = ?';
  const semesterParams = programSemester === null ? [] : [programSemester];

  const slotsToDelete = await all(
    `SELECT id, courseId FROM timetable_slots WHERE termId = ? AND ${semesterClause}`,
    [termId, ...semesterParams]
  );
  const deletedSlots = slotsToDelete.length;
  const affectedCourseIds = [...new Set(slotsToDelete.map(s => s.courseId).filter(Boolean))];

  await run(`DELETE FROM timetable_slots WHERE termId = ? AND ${semesterClause}`, [termId, ...semesterParams]);

  let deletedCourses = 0;
  let deletedTeachers = 0;
  if (deep) {
    for (const courseId of affectedCourseIds) {
      const stillUsed = await get('SELECT id FROM timetable_slots WHERE courseId = ? LIMIT 1', [courseId]);
      if (stillUsed) continue; // still scheduled elsewhere (another semester/section) — not orphaned
      const course = await get('SELECT teacherId FROM courses WHERE id = ?', [courseId]);
      if (!course) continue;
      const hasEnrollments = await get('SELECT id FROM enrollments WHERE courseId = ? LIMIT 1', [courseId]);
      const hasExams = await get('SELECT id FROM exams WHERE courseId = ? LIMIT 1', [courseId]);
      if (hasEnrollments || hasExams) continue; // real data attached — not a test artifact anymore

      await run('DELETE FROM course_prerequisites WHERE courseId = ? OR prerequisiteCourseId = ?', [courseId, courseId]);
      await run('DELETE FROM courses WHERE id = ?', [courseId]);
      deletedCourses++;

      if (course.teacherId) {
        const teacher = await get('SELECT userId FROM teachers WHERE id = ?', [course.teacherId]);
        // Never remove a teacher with a real login — only clean up bare, login-less records.
        if (teacher && !teacher.userId) {
          const stillReferenced = await get('SELECT id FROM courses WHERE teacherId = ? LIMIT 1', [course.teacherId]);
          const invigilating = await get('SELECT id FROM exams WHERE invigilatorId = ? LIMIT 1', [course.teacherId]);
          if (!stillReferenced && !invigilating) {
            await run('DELETE FROM teachers WHERE id = ?', [course.teacherId]);
            deletedTeachers++;
          }
        }
      }
    }
  }

  await logAudit(req.user, 'timetable-reset', 'timetable_slots', null, {
    termId, programSemester, deep: !!deep, deletedSlots, deletedCourses, deletedTeachers
  });

  const data = await loadTermData(termId);
  const conflicts = computeConflicts(data);

  res.status(200).json({ deletedSlots, deletedCourses, deletedTeachers, conflicts });
}));

module.exports = router;
