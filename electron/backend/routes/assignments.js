const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { all, get, run, logAudit, DB_PATH } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { canManageCourse } = require('../ownership');
const { notifyCourseStudents } = require('../notify');

const router = express.Router();

// Lives next to the database file itself, same rationale as BRANDING_DIR in settings.js —
// moves with the DB on backup/restore, stays per-install, never bundled with app source.
const SUBMISSIONS_DIR = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'submissions');
const submissionFile = (assignmentId, studentId) => path.join(SUBMISSIONS_DIR, `${assignmentId}_${studentId}`);

const ALLOWED_SUBMISSION_TYPES = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'application/zip', 'image/png', 'image/jpeg',
]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/** Loads `course` for `courseId` and 403s a faculty user who doesn't own it (admin always passes). */
async function requireCourseAccess(req, courseId) {
  const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (!course) return { course: null, error: { status: 404, message: 'Course not found' } };
  if (!(await canManageCourse(req, course))) {
    return { course: null, error: { status: 403, message: 'You do not have access to this course.' } };
  }
  return { course, error: null };
}

async function requireEnrollment(req, courseId) {
  const enrolled = await get(`SELECT id FROM enrollments WHERE courseId = ? AND studentId = ? AND status = 'enrolled'`, [courseId, req.user.sub]);
  return !!enrolled;
}

// --- List assignments for a course — admin/faculty see submission counts, a student sees their own status ---

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId is required' });

  if (req.user.role === 'student') {
    if (!(await requireEnrollment(req, courseId))) return res.status(403).json({ error: 'You are not enrolled in this course.' });
    const rows = await all('SELECT * FROM assignments WHERE courseId = ? ORDER BY createdAt DESC', [courseId]);
    const result = [];
    for (const a of rows) {
      const sub = await get('SELECT fileName, textResponse, marksAwarded, feedback, submittedAt FROM assignment_submissions WHERE assignmentId = ? AND studentId = ?', [a.id, req.user.sub]);
      result.push({ ...a, mySubmission: sub || null });
    }
    return res.json(result);
  }

  const { error } = await requireCourseAccess(req, courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  const rows = await all('SELECT * FROM assignments WHERE courseId = ? ORDER BY createdAt DESC', [courseId]);
  const totalEnrolled = (await get(`SELECT COUNT(*) as n FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [courseId])).n;
  const result = [];
  for (const a of rows) {
    const submittedCount = (await get('SELECT COUNT(*) as n FROM assignment_submissions WHERE assignmentId = ?', [a.id])).n;
    result.push({ ...a, submittedCount, totalEnrolled });
  }
  res.json(result);
}));

router.post('/', requireAuth, requireRole('admin', 'faculty'), asyncHandler(async (req, res) => {
  const { courseId, title, description, dueDate, maxMarks } = req.body;
  if (!courseId || !String(title || '').trim()) return res.status(400).json({ error: 'courseId and title are required' });
  if (!dueDate) return res.status(400).json({ error: 'Due date is required' });
  let max = null;
  if (maxMarks != null && maxMarks !== '') {
    max = Number(maxMarks);
    if (Number.isNaN(max) || max <= 0) return res.status(400).json({ error: 'Max marks must be greater than 0' });
  }

  const { course, error } = await requireCourseAccess(req, courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  const result = await run(
    'INSERT INTO assignments (courseId, title, description, dueDate, maxMarks, createdBy) VALUES (?, ?, ?, ?, ?, ?)',
    [course.id, title.trim(), (description || '').trim() || null, dueDate, max, req.user.sub]
  );
  await logAudit(req.user, 'create-assignment', 'assignments', result.id, { courseId: course.id, title: title.trim() });

  const message = `New assignment posted in ${course.code} — ${course.name}: "${title.trim()}"${dueDate ? ` (due ${dueDate})` : ''}`;
  await notifyCourseStudents(course.id, message, { type: 'assignment', entityType: 'assignment', entityId: result.id });

  res.status(201).json(await get('SELECT * FROM assignments WHERE id = ?', [result.id]));
}));

// --- Submissions for one assignment — admin/faculty roster view ---

router.get('/:id/submissions', requireAuth, requireRole('admin', 'faculty'), asyncHandler(async (req, res) => {
  const assignment = await get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  const { error } = await requireCourseAccess(req, assignment.courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  const roster = await all(
    `SELECT u.id as studentId, u.name, u.idNumber
     FROM enrollments e JOIN users u ON u.id = e.studentId
     WHERE e.courseId = ? AND e.status = 'enrolled' ORDER BY u.name`,
    [assignment.courseId]
  );
  const submissions = await all('SELECT * FROM assignment_submissions WHERE assignmentId = ?', [assignment.id]);
  const rows = roster.map(s => ({
    studentId: s.studentId, name: s.name, idNumber: s.idNumber,
    submission: submissions.find(sub => sub.studentId === s.studentId) || null,
  }));
  res.json({ assignment, rows });
}));

// --- A student submits (or resubmits) their own work ---

router.post('/:id/submissions', requireAuth, requireRole('student'), upload.single('file'), asyncHandler(async (req, res) => {
  const assignment = await get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (!(await requireEnrollment(req, assignment.courseId))) return res.status(403).json({ error: 'You are not enrolled in this course.' });

  const textResponse = (req.body.textResponse || '').trim() || null;
  if (!req.file && !textResponse) return res.status(400).json({ error: 'Attach a file or write a response before submitting.' });
  if (req.file && !ALLOWED_SUBMISSION_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'That file type is not supported.' });
  }
  if (req.file && !SUBMISSIONS_DIR) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });

  if (req.file) {
    fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });
    fs.writeFileSync(submissionFile(assignment.id, req.user.sub), req.file.buffer);
  }

  const existing = await get('SELECT id FROM assignment_submissions WHERE assignmentId = ? AND studentId = ?', [assignment.id, req.user.sub]);
  if (existing) {
    // A resubmission overwrites the previous file/text and clears any prior grading —
    // the instructor is re-reviewing new work, not the work they already marked.
    await run(
      `UPDATE assignment_submissions SET
         fileName = COALESCE(?, fileName), fileMimeType = COALESCE(?, fileMimeType),
         textResponse = ?, marksAwarded = NULL, feedback = NULL, submittedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.file ? req.file.originalname : null, req.file ? req.file.mimetype : null, textResponse, existing.id]
    );
  } else {
    await run(
      'INSERT INTO assignment_submissions (assignmentId, studentId, fileName, fileMimeType, textResponse) VALUES (?, ?, ?, ?, ?)',
      [assignment.id, req.user.sub, req.file ? req.file.originalname : null, req.file ? req.file.mimetype : null, textResponse]
    );
  }
  res.status(201).json(await get('SELECT * FROM assignment_submissions WHERE assignmentId = ? AND studentId = ?', [assignment.id, req.user.sub]));
}));

// --- Download a submitted file — the owning student, or admin/faculty who manages the course ---

router.get('/:id/submissions/:studentId/file', requireAuth, asyncHandler(async (req, res) => {
  const assignment = await get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  const isOwner = req.user.role === 'student' && req.user.sub === Number(req.params.studentId);
  if (!isOwner) {
    const { error } = await requireCourseAccess(req, assignment.courseId);
    if (error) return res.status(error.status).json({ error: error.message });
  }
  const submission = await get('SELECT * FROM assignment_submissions WHERE assignmentId = ? AND studentId = ?', [assignment.id, req.params.studentId]);
  if (!submission || !submission.fileName || !SUBMISSIONS_DIR || !fs.existsSync(submissionFile(assignment.id, req.params.studentId))) {
    return res.status(404).json({ error: 'No file for this submission' });
  }
  res.download(submissionFile(assignment.id, req.params.studentId), submission.fileName);
}));

// --- Faculty/admin records marks + feedback on a submission ---

router.put('/:id/submissions/:studentId', requireAuth, requireRole('admin', 'faculty'), asyncHandler(async (req, res) => {
  const assignment = await get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  const { error } = await requireCourseAccess(req, assignment.courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  const submission = await get('SELECT * FROM assignment_submissions WHERE assignmentId = ? AND studentId = ?', [assignment.id, req.params.studentId]);
  if (!submission) return res.status(404).json({ error: 'No submission from this student yet' });

  const { marksAwarded, feedback } = req.body;
  let marks = null;
  if (marksAwarded != null && marksAwarded !== '') {
    marks = Number(marksAwarded);
    const cap = assignment.maxMarks ?? Infinity;
    if (Number.isNaN(marks) || marks < 0 || marks > cap) {
      return res.status(400).json({ error: assignment.maxMarks ? `Marks must be between 0 and ${assignment.maxMarks}` : 'Marks must be 0 or greater' });
    }
  }
  await run('UPDATE assignment_submissions SET marksAwarded = ?, feedback = ? WHERE id = ?', [marks, (feedback || '').trim() || null, submission.id]);
  await logAudit(req.user, 'grade-submission', 'assignment_submissions', submission.id, { assignmentId: assignment.id, studentId: Number(req.params.studentId), marksAwarded: marks });
  res.json(await get('SELECT * FROM assignment_submissions WHERE id = ?', [submission.id]));
}));

module.exports = router;
