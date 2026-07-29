const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { all, get, run, logAudit, DB_PATH } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { canManageCourse } = require('../ownership');

const router = express.Router();

// Lives next to the database file itself, same rationale as SUBMISSIONS_DIR in assignments.js.
const MATERIALS_DIR = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'materials');
const materialFile = (materialId) => path.join(MATERIALS_DIR, String(materialId));

const ALLOWED_MATERIAL_TYPES = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'application/zip', 'image/png', 'image/jpeg',
]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function requireCourseAccess(req, courseId) {
  const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (!course) return { course: null, error: { status: 404, message: 'Course not found' } };
  if (!(await canManageCourse(req, course))) {
    return { course: null, error: { status: 403, message: 'You do not have access to this course.' } };
  }
  return { course, error: null };
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId is required' });

  if (req.user.role === 'student') {
    const enrolled = await get(`SELECT id FROM enrollments WHERE courseId = ? AND studentId = ? AND status = 'enrolled'`, [courseId, req.user.sub]);
    if (!enrolled) return res.status(403).json({ error: 'You are not enrolled in this course.' });
  } else {
    const { error } = await requireCourseAccess(req, courseId);
    if (error) return res.status(error.status).json({ error: error.message });
  }

  const rows = await all(
    `SELECT m.*, u.name as uploaderName FROM course_materials m LEFT JOIN users u ON u.id = m.createdBy
     WHERE m.courseId = ? ORDER BY m.createdAt DESC`,
    [courseId]
  );
  res.json(rows);
}));

router.post('/', requireAuth, requireRole('admin', 'faculty'), upload.single('file'), asyncHandler(async (req, res) => {
  const { courseId, title } = req.body;
  if (!courseId || !String(title || '').trim()) return res.status(400).json({ error: 'courseId and title are required' });
  if (!req.file) return res.status(400).json({ error: 'A file is required' });
  if (!ALLOWED_MATERIAL_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'That file type is not supported.' });
  if (!MATERIALS_DIR) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });

  const { course, error } = await requireCourseAccess(req, courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  const result = await run(
    'INSERT INTO course_materials (courseId, title, fileName, fileMimeType, createdBy) VALUES (?, ?, ?, ?, ?)',
    [course.id, title.trim(), req.file.originalname, req.file.mimetype, req.user.sub]
  );
  fs.mkdirSync(MATERIALS_DIR, { recursive: true });
  fs.writeFileSync(materialFile(result.id), req.file.buffer);
  await logAudit(req.user, 'post-material', 'course_materials', result.id, { courseId: course.id, title: title.trim() });

  res.status(201).json(await get('SELECT m.*, u.name as uploaderName FROM course_materials m LEFT JOIN users u ON u.id = m.createdBy WHERE m.id = ?', [result.id]));
}));

router.delete('/:id', requireAuth, requireRole('admin', 'faculty'), asyncHandler(async (req, res) => {
  const material = await get('SELECT * FROM course_materials WHERE id = ?', [req.params.id]);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  const { error } = await requireCourseAccess(req, material.courseId);
  if (error) return res.status(error.status).json({ error: error.message });

  await run('DELETE FROM course_materials WHERE id = ?', [req.params.id]);
  if (MATERIALS_DIR && fs.existsSync(materialFile(material.id))) fs.unlinkSync(materialFile(material.id));
  await logAudit(req.user, 'delete-material', 'course_materials', material.id, { courseId: material.courseId, title: material.title });
  res.status(204).end();
}));

router.get('/:id/file', requireAuth, asyncHandler(async (req, res) => {
  const material = await get('SELECT * FROM course_materials WHERE id = ?', [req.params.id]);
  if (!material) return res.status(404).json({ error: 'Material not found' });

  if (req.user.role === 'student') {
    const enrolled = await get(`SELECT id FROM enrollments WHERE courseId = ? AND studentId = ? AND status = 'enrolled'`, [material.courseId, req.user.sub]);
    if (!enrolled) return res.status(403).json({ error: 'You are not enrolled in this course.' });
  } else {
    const { error } = await requireCourseAccess(req, material.courseId);
    if (error) return res.status(error.status).json({ error: error.message });
  }

  if (!MATERIALS_DIR || !fs.existsSync(materialFile(material.id))) return res.status(404).json({ error: 'File not found' });
  res.download(materialFile(material.id), material.fileName);
}));

module.exports = router;
