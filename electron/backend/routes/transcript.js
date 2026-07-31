const express = require('express');
const { get, all } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { can } = require('../permissions');
const { computeAcademicSummary } = require('../academicSummary');
const { getGradingScale } = require('../gradingScale');

const router = express.Router();

// --- One student's full academic transcript — records staff for anyone, a student for
//     themselves. Mirrors finance.js's canViewStatement/GET /finance/students/:studentId split. ---

function canViewTranscript(req, studentId) {
  if (Number(req.user.sub) === Number(studentId)) return true;
  return can(req.user.role, 'students', 'read');
}

/** Every currently-enrolled OR withdrawn course for `studentId`, joined through to its term,
    ordered so terms come out chronologically and courses alphabetically within a term. enrollments
    has no termId of its own — a course's term is reached via courses.termId. A null grade on an
    'enrolled' row means the course is still in progress (gradebook incomplete), never a failing/
    zero result; a 'withdrawn' row always displays as "W" regardless of e.grade (withdrawing wipes
    any in-progress gradebook standing off the transcript — see routes/enrollments.js). Either way
    computeAcademicSummary below only ever counts status='enrolled', so a withdrawal never touches
    GPA or completed/attempted credits. */
async function loadTranscript(studentId) {
  const rows = await all(
    `SELECT e.grade, e.status, c.id as courseId, c.code, c.name, c.credits, t.id as termId, t.name as termName, t.startDate
     FROM enrollments e JOIN courses c ON c.id = e.courseId JOIN terms t ON t.id = c.termId
     WHERE e.studentId = ? AND e.status IN ('enrolled', 'withdrawn')
     ORDER BY t.startDate, t.id, c.code`,
    [studentId]
  );

  const termsById = new Map();
  for (const r of rows) {
    if (!termsById.has(r.termId)) {
      termsById.set(r.termId, { termId: r.termId, termName: r.termName, startDate: r.startDate, courses: [] });
    }
    const withdrawn = r.status === 'withdrawn';
    termsById.get(r.termId).courses.push({
      code: r.code, name: r.name, credits: r.credits, grade: withdrawn ? 'W' : r.grade,
      inProgress: !withdrawn && r.grade == null, withdrawn,
    });
  }

  const terms = [];
  for (const term of termsById.values()) {
    const summary = await computeAcademicSummary(studentId, { termId: term.termId });
    terms.push({ ...term, termGpa: summary.gpa, termCredits: summary.completedCredits });
  }

  const cumulative = await computeAcademicSummary(studentId);
  const gradingScaleLegend = (await getGradingScale()).map(b => ({ label: b.label, point: b.point }));

  return {
    terms,
    cumulative: { gpa: cumulative.gpa, completedCredits: cumulative.completedCredits, attemptedCredits: cumulative.attemptedCredits },
    gradingScaleLegend,
  };
}

async function loadStudentHeader(studentId) {
  const student = await get('SELECT id, name, email, idNumber FROM users WHERE id = ? AND role = \'student\'', [studentId]);
  if (!student) return null;
  const profile = await get(
    `SELECT departmentId, programId, programSemester, admissionStatus, studentStatus, graduationStatus, graduationDate, enrollmentDate
     FROM student_profiles WHERE studentId = ?`,
    [studentId]
  );
  const department = profile?.departmentId ? await get('SELECT id, name FROM departments WHERE id = ?', [profile.departmentId]) : null;
  const program = profile?.programId ? await get('SELECT id, name, totalCredits FROM programs WHERE id = ?', [profile.programId]) : null;
  return {
    student,
    department,
    program,
    studentStatus: profile?.studentStatus ?? 'Active',
    graduationStatus: profile?.graduationStatus ?? null,
    graduationDate: profile?.graduationDate ?? null,
    enrollmentDate: profile?.enrollmentDate ?? null,
  };
}

async function respondWithTranscript(req, res, studentId) {
  const header = await loadStudentHeader(studentId);
  if (!header) return res.status(404).json({ error: 'Student not found' });
  const body = await loadTranscript(studentId);
  res.json({ ...header, ...body });
}

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  await respondWithTranscript(req, res, Number(req.user.sub));
}));

router.get('/students/:studentId', requireAuth, asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!canViewTranscript(req, studentId)) return res.status(403).json({ error: 'Forbidden' });
  await respondWithTranscript(req, res, studentId);
}));

module.exports = router;
