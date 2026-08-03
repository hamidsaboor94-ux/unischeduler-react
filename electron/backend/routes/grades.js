const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { canManageCourse } = require('../ownership');
const { can } = require('../permissions');
const { recomputeFinalGrade, recomputeFinalGradesForCourse } = require('../gradingScale');

const router = express.Router();
const { safeCreateNotification } = require('../notificationTypes');
const CATEGORIES = ['assignment', 'quiz', 'midterm', 'exam', 'final'];
// Display order for the spreadsheet-style sheet — quizzes (there can be several) group
// together first, then the single assignment/midterm/final columns.
const CATEGORY_ORDER = { quiz: 0, assignment: 1, midterm: 2, exam: 3, final: 4 };

/** The first time a course's gradebook is opened, it starts with these four standard columns
    already in place — no per-course setup step required. maxScore is just a starting point
    ("weighting" in a simple sum-of-raw-points scheme); an instructor can adjust any column's
    max score afterward (PUT /grades/items/:id) to redefine that weighting. Sums to 100. */
const DEFAULT_GRADE_ITEMS = [
  { name: 'Quiz 1', category: 'quiz', maxScore: 10 },
  { name: 'Assignment', category: 'assignment', maxScore: 15 },
  { name: 'Midterm', category: 'midterm', maxScore: 25 },
  { name: 'Final', category: 'final', maxScore: 50 },
];

async function ensureDefaultGradeItems(courseId) {
  const existing = await get('SELECT id FROM grade_items WHERE courseId = ? LIMIT 1', [courseId]);
  if (existing) return;
  for (const item of DEFAULT_GRADE_ITEMS) {
    await run('INSERT INTO grade_items (courseId, name, category, maxScore) VALUES (?, ?, ?, ?)', [courseId, item.name, item.category, item.maxScore]);
  }
}

function sortItems(items) {
  return items.slice().sort((a, b) => (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99) || a.id - b.id);
}

/** Loads `course` and enforces access for `action` ('read' | 'write'). A staff
    grader (Records Officer for write, plus Viewer for read) reaches any course's
    gradebook university-wide; faculty only their own course; admin always. */
async function requireCourseAccess(req, courseId, action = 'write') {
  const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (!course) return { course: null, error: { status: 404, message: 'Course not found' } };
  const role = req.user.role;
  const staffGrader = role !== 'faculty' && role !== 'student' && can(role, 'grades', action);
  if (!staffGrader && !(await canManageCourse(req, course))) {
    return { course: null, error: { status: 403, message: 'You do not have access to this course.' } };
  }
  return { course, error: null };
}

/** One course's full gradebook: every grade item (column) x every currently-enrolled student
    (row). Each row carries the raw per-item scores plus two derived numbers:
    - totalEarned/totalPossible/hasAnyScore: a plain spreadsheet-style running SUM (blank
      cells count as 0), for the sheet's own "Total" column.
    - average: percent of points earned across only the items actually scored so far (blank
      items excluded from both sides) — kept for the department-wide class-average rollup,
      which would otherwise be skewed by how many columns a course happens to have filled in. */
async function buildCourseGradebook(courseId) {
  await ensureDefaultGradeItems(courseId);
  const items = sortItems(await all('SELECT * FROM grade_items WHERE courseId = ?', [courseId]));
  const students = await all(
    `SELECT u.id as studentId, u.name, u.idNumber, e.grade as letterGrade
     FROM enrollments e JOIN users u ON u.id = e.studentId
     WHERE e.courseId = ? AND e.status = 'enrolled' ORDER BY u.name`,
    [courseId]
  );
  const scores = items.length
    ? await all(`SELECT * FROM grade_scores WHERE gradeItemId IN (${items.map(() => '?').join(',')})`, items.map(i => i.id))
    : [];
  const totalPossible = items.reduce((sum, it) => sum + it.maxScore, 0);

  const rows = students.map(s => {
    const scoreMap = {};
    let earnedGraded = 0, possibleGraded = 0, totalEarned = 0, hasAnyScore = false;
    for (const item of items) {
      const rec = scores.find(sc => sc.gradeItemId === item.id && sc.studentId === s.studentId);
      const value = rec ? rec.score : null;
      scoreMap[item.id] = value;
      if (value != null) {
        earnedGraded += value; possibleGraded += item.maxScore;
        totalEarned += value; hasAnyScore = true;
      }
    }
    const average = possibleGraded > 0 ? Math.round((earnedGraded / possibleGraded) * 1000) / 10 : null;
    return {
      studentId: s.studentId, name: s.name, idNumber: s.idNumber, letterGrade: s.letterGrade,
      scores: scoreMap, average, totalEarned, totalPossible, hasAnyScore,
    };
  });

  return { items, rows };
}

// --- Grade items (the gradebook's "columns") — admin any course, faculty only their own ---

router.get('/items', requireAuth, asyncHandler(async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId is required' });
  const { error } = await requireCourseAccess(req, courseId, 'read');
  if (error) return res.status(error.status).json({ error: error.message });
  await ensureDefaultGradeItems(courseId);
  res.json(sortItems(await all('SELECT * FROM grade_items WHERE courseId = ?', [courseId])));
}));

router.post('/items', requireAuth, asyncHandler(async (req, res) => {
  const { courseId, name, category, maxScore } = req.body;
  if (!courseId || !String(name || '').trim()) return res.status(400).json({ error: 'courseId and name are required' });
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: `Category must be one of ${CATEGORIES.join(', ')}` });
  const max = maxScore != null && maxScore !== '' ? Number(maxScore) : 100;
  if (!(max > 0)) return res.status(400).json({ error: 'Max score must be greater than 0' });

  const { course, error } = await requireCourseAccess(req, courseId);
  if (error) return res.status(error.status).json({ error: error.message });
  await ensureDefaultGradeItems(courseId);

  const result = await run(
    'INSERT INTO grade_items (courseId, name, category, maxScore) VALUES (?, ?, ?, ?)',
    [course.id, name.trim(), category || 'assignment', max]
  );
  await logAudit(req.user, 'create-grade-item', 'grade_items', result.id, { courseId: course.id, name: name.trim(), category, maxScore: max });
  // A new (unscored) column means nobody's gradebook is "complete" anymore — clears any
  // final grades that were computed before this item existed.
  await recomputeFinalGradesForCourse(course.id);
  res.status(201).json(await get('SELECT * FROM grade_items WHERE id = ?', [result.id]));
}));

router.put('/items/:id', requireAuth, asyncHandler(async (req, res) => {
  const item = await get('SELECT * FROM grade_items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { error } = await requireCourseAccess(req, item.courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  const { name, category, maxScore } = req.body;
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: `Category must be one of ${CATEGORIES.join(', ')}` });
  const max = maxScore != null && maxScore !== '' ? Number(maxScore) : item.maxScore;
  if (!(max > 0)) return res.status(400).json({ error: 'Max score must be greater than 0' });
  const trimmedName = name != null ? String(name).trim() : item.name;
  if (!trimmedName) return res.status(400).json({ error: 'Name is required' });

  await run('UPDATE grade_items SET name = ?, category = ?, maxScore = ? WHERE id = ?', [trimmedName, category || item.category, max, item.id]);
  await logAudit(req.user, 'update-grade-item', 'grade_items', item.id, { name: trimmedName, category, maxScore: max });
  // A changed max score shifts totalPossible for everyone in this course.
  await recomputeFinalGradesForCourse(item.courseId);
  res.json(await get('SELECT * FROM grade_items WHERE id = ?', [item.id]));
}));

router.delete('/items/:id', requireAuth, asyncHandler(async (req, res) => {
  const item = await get('SELECT * FROM grade_items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { error } = await requireCourseAccess(req, item.courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  await run('DELETE FROM grade_items WHERE id = ?', [item.id]);
  await logAudit(req.user, 'delete-grade-item', 'grade_items', item.id, { courseId: item.courseId, name: item.name });
  // Removing a column can turn a previously-incomplete gradebook complete (or shift totals).
  await recomputeFinalGradesForCourse(item.courseId);
  res.status(204).end();
}));

// --- One student's score on one item — upserted (admin any course, faculty their own) ---

router.put('/score', requireAuth, asyncHandler(async (req, res) => {
  const { gradeItemId, studentId, score } = req.body;
  if (!gradeItemId || !studentId) return res.status(400).json({ error: 'gradeItemId and studentId are required' });

  const item = await get('SELECT * FROM grade_items WHERE id = ?', [gradeItemId]);
  if (!item) return res.status(404).json({ error: 'Grade item not found' });
  const { error } = await requireCourseAccess(req, item.courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  const enrolled = await get(`SELECT id FROM enrollments WHERE courseId = ? AND studentId = ? AND status = 'enrolled'`, [item.courseId, studentId]);
  if (!enrolled) return res.status(404).json({ error: 'That student is not enrolled in this course.' });

  let value = null;
  if (score !== null && score !== '' && score !== undefined) {
    value = Number(score);
    if (Number.isNaN(value) || value < 0 || value > item.maxScore) {
      return res.status(400).json({ error: `Score must be between 0 and ${item.maxScore}` });
    }
  }

  const existing = await get('SELECT id FROM grade_scores WHERE gradeItemId = ? AND studentId = ?', [gradeItemId, studentId]);
  if (existing) {
    await run('UPDATE grade_scores SET score = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [value, existing.id]);
  } else {
    await run('INSERT INTO grade_scores (gradeItemId, studentId, score) VALUES (?, ?, ?)', [gradeItemId, studentId, value]);
  }
  await logAudit(req.user, 'set-grade-score', 'grade_scores', existing?.id ?? null, { gradeItemId: Number(gradeItemId), studentId: Number(studentId), score: value });
  const letterGrade = await recomputeFinalGrade(item.courseId, Number(studentId));
  res.json({ gradeItemId: Number(gradeItemId), studentId: Number(studentId), score: value, letterGrade });
}));

// --- Full single-course gradebook grid — admin any course, faculty only their own ---

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId is required' });
  const { error } = await requireCourseAccess(req, courseId, 'read');
  if (error) return res.status(error.status).json({ error: error.message });
  res.json(await buildCourseGradebook(Number(courseId)));
}));

// --- Department-wide (or all-courses) rollup — admin only ---

router.get('/department-summary', requireAuth, asyncHandler(async (req, res) => {
  // A cross-course rollup — university-wide grade readers only (admin, Records
  // Officer, Viewer). Faculty/students never see other courses in aggregate.
  if (req.user.role === 'faculty' || req.user.role === 'student') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { departmentId } = req.query;
  const courses = departmentId
    ? await all('SELECT * FROM courses WHERE departmentId = ? ORDER BY code', [departmentId])
    : await all('SELECT * FROM courses ORDER BY code');

  const summary = [];
  for (const course of courses) {
    const { rows } = await buildCourseGradebook(course.id);
    const graded = rows.filter(r => r.average != null);
    const classAverage = graded.length ? Math.round((graded.reduce((sum, r) => sum + r.average, 0) / graded.length) * 10) / 10 : null;
    summary.push({ course, studentCount: rows.length, gradedCount: graded.length, classAverage });
  }
  res.json(summary);
}));

// --- A student's own grades, across every course they're enrolled in — never anyone else's.
//     Scoped entirely by req.user.sub in the WHERE clause below, same pattern as
//     GET /enrollments/me and GET /attendance/me: no role check needed beyond requireAuth,
//     since the query itself can never return another student's row. ---

// Formal result release. Draft score edits never notify students; only this committed action does.
router.post('/courses/:courseId/publish',requireAuth,asyncHandler(async(req,res)=>{
  const courseId=Number(req.params.courseId),{course,error}=await requireCourseAccess(req,courseId);
  if(error)return res.status(error.status).json({error:error.message});
  await recomputeFinalGradesForCourse(courseId);
  const rows=await all(`SELECT e.studentId,e.grade FROM enrollments e WHERE e.courseId=? AND e.status='enrolled'`,[courseId]);
  const incomplete=rows.filter(r=>!r.grade);if(incomplete.length)return res.status(409).json({error:`${incomplete.length} enrolled student(s) still have incomplete final grades.`,code:'INCOMPLETE_GRADES'});
  let published=0,changed=0;
  for(const row of rows){
    const previous=await get('SELECT * FROM published_grades WHERE courseId=? AND studentId=?',[courseId,row.studentId]);
    const type=previous&&previous.letterGrade!==row.grade?'grade_changed':'grade_published';
    if(previous&&previous.letterGrade===row.grade)continue;
    await run(`INSERT INTO published_grades(courseId,studentId,letterGrade,publishedBy) VALUES(?,?,?,?) ON CONFLICT(courseId,studentId) DO UPDATE SET letterGrade=excluded.letterGrade,publishedBy=excluded.publishedBy,publishedAt=CURRENT_TIMESTAMP`,[courseId,row.studentId,row.grade,req.user.sub]);
    await safeCreateNotification({recipientUserId:row.studentId,type,title:type==='grade_changed'?'Published grade changed':'Final grade published',
      message:`Your final result for ${course.code} — ${course.name} is ${row.grade}.`,severity:row.grade==='F'?'warning':'success',entityType:'course',entityId:courseId,
      courseId,actionSection:'mygrades',deduplicationKey:`published-grade:${courseId}:${row.studentId}:${row.grade}`,createdBy:req.user.sub,category:'academic_updates'});
    if(type==='grade_changed')changed++;else published++;
  }
  await run('UPDATE courses SET resultsPublishedAt=CURRENT_TIMESTAMP WHERE id=?',[courseId]);
  await logAudit(req.user,'publish-results','courses',courseId,{published,changed});res.json({courseId,published,changed});
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const enrollments = await all(
    `SELECT e.grade as letterGrade, c.id, c.code, c.name, c.credits
     FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE e.studentId = ? AND e.status = 'enrolled' ORDER BY c.code`,
    [req.user.sub]
  );

  const result = [];
  for (const course of enrollments) {
    // No auto-provisioning here — a student shouldn't be the reason a course's gradebook gets
    // created. If the instructor hasn't opened their gradebook yet, this course just has no
    // items, same as if nothing had been graded.
    const items = sortItems(await all('SELECT * FROM grade_items WHERE courseId = ?', [course.id]));
    const scores = items.length
      ? await all(
        `SELECT * FROM grade_scores WHERE studentId = ? AND gradeItemId IN (${items.map(() => '?').join(',')})`,
        [req.user.sub, ...items.map(i => i.id)]
      )
      : [];
    const totalPossible = items.reduce((sum, it) => sum + it.maxScore, 0);

    let earnedGraded = 0, possibleGraded = 0, totalEarned = 0, hasAnyScore = false;
    const itemRows = items.map(item => {
      const rec = scores.find(s => s.gradeItemId === item.id);
      const value = rec ? rec.score : null;
      if (value != null) {
        earnedGraded += value; possibleGraded += item.maxScore;
        totalEarned += value; hasAnyScore = true;
      }
      return { id: item.id, name: item.name, category: item.category, maxScore: item.maxScore, score: value };
    });
    const average = possibleGraded > 0 ? Math.round((earnedGraded / possibleGraded) * 1000) / 10 : null;

    result.push({
      course: { id: course.id, code: course.code, name: course.name, credits: course.credits },
      letterGrade: course.letterGrade,
      items: itemRows,
      average, totalEarned, totalPossible, hasAnyScore,
    });
  }
  res.json(result);
}));

module.exports = router;
