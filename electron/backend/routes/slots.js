const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { runOrFriendlyError } = require('./crudRouter');
const { courseScopeClause, enrolledCourseIds } = require('../ownership');
const { overlapsMinutes } = require('../scheduling');

const router = express.Router();
const FIELDS = ['courseId', 'day', 'time', 'durationMinutes', 'roomId', 'termId', 'programSemester', 'section'];

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM timetable_slots');
  if (req.user.role === 'admin') return res.json(rows);
  if (req.user.role === 'faculty') {
    const scope = await courseScopeClause(req);
    const ownedCourseIds = new Set((await all(`SELECT id FROM courses WHERE ${scope.clause}`, scope.params)).map(c => c.id));
    return res.json(rows.filter(s => ownedCourseIds.has(s.courseId)));
  }
  const myCourseIds = new Set(await enrolledCourseIds(req.user.sub));
  res.json(rows.filter(s => myCourseIds.has(s.courseId)));
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM timetable_slots WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

/** True if an identical slot (same course/day/time/room/term/semester/section — the same class
    meeting, not just an overlap) already exists, optionally excluding one row's own id (for PUT). */
async function identicalSlotExists(slot, excludeId) {
  // Every field goes through `IS ?` (NULL-safe), not `= ?` — several of these (room, semester,
  // section, even term in some test/edge setups) are legitimately optional, and `col = NULL`
  // never matches in SQL, which would silently defeat the duplicate check whenever one is unset.
  const params = [
    slot.courseId ?? null, slot.day ?? null, slot.time ?? null, slot.roomId ?? null,
    slot.termId ?? null, slot.programSemester ?? null, slot.section ?? null, slot.durationMinutes ?? 60
  ];
  let sql = `SELECT id FROM timetable_slots
     WHERE courseId IS ? AND day IS ? AND time IS ? AND roomId IS ? AND termId IS ?
       AND programSemester IS ? AND section IS ? AND durationMinutes = ?`;
  if (excludeId) { sql += ' AND id != ?'; params.push(excludeId); }
  return !!(await get(sql, params));
}

/** Describes every existing slot that would overlap `slot` in time on the same day (same
    room and/or same instructor — regardless of course), so the admin creating/editing this
    slot is told exactly what it clashes with immediately, instead of only finding out later
    on the Conflicts page. Non-blocking: overlaps are allowed (real timetables sometimes need
    to accept one temporarily), this just makes sure they're never silent. */
async function describeOverlaps(slot, excludeId) {
  const duration = slot.durationMinutes || 60;
  const course = slot.courseId
    ? await get('SELECT code, teacherId FROM courses WHERE id = ?', [slot.courseId])
    : null;
  const rows = await all(
    `SELECT ts.id, ts.time, ts.durationMinutes, ts.roomId, c.code as courseCode, c.teacherId,
            r.name as roomName, t.name as teacherName
     FROM timetable_slots ts
     JOIN courses c ON c.id = ts.courseId
     LEFT JOIN rooms r ON r.id = ts.roomId
     LEFT JOIN teachers t ON t.id = c.teacherId
     WHERE ts.day IS ? AND ts.termId IS ?${excludeId ? ' AND ts.id != ?' : ''}`,
    excludeId ? [slot.day ?? null, slot.termId ?? null, excludeId] : [slot.day ?? null, slot.termId ?? null]
  );
  const warnings = [];
  for (const s of rows) {
    if (!overlapsMinutes(s.time, s.durationMinutes || 60, slot.time, duration)) continue;
    if (slot.roomId != null && s.roomId === slot.roomId) {
      warnings.push(`Same room (${s.roomName || 'this room'}) as ${s.courseCode} at ${s.time} on ${slot.day}`);
    }
    if (course?.teacherId != null && s.teacherId === course.teacherId) {
      warnings.push(`Same instructor (${s.teacherName || 'this instructor'}) as ${s.courseCode} at ${s.time} on ${slot.day}`);
    }
  }
  return warnings;
}

router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const cols = FIELDS.filter(f => req.body[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'No fields provided' });
  if (await identicalSlotExists(req.body)) {
    return res.status(409).json({ error: 'An identical timetable slot already exists (same course, day, time, room, semester and section).' });
  }
  const result = await runOrFriendlyError(res, 'timetable_slots', () => run(
    `INSERT INTO timetable_slots (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map(c => req.body[c])
  ));
  if (result === undefined) return;
  const row = await get('SELECT * FROM timetable_slots WHERE id = ?', [result.id]);
  await logAudit(req.user, 'create', 'timetable_slots', result.id, req.body);
  const conflictWarnings = await describeOverlaps(row, row.id);
  res.status(201).json({ ...row, conflictWarnings });
}));

router.put('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const cols = FIELDS.filter(f => req.body[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  const current = await get('SELECT * FROM timetable_slots WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Not found' });
  const merged = { ...current, ...req.body };
  if (await identicalSlotExists(merged, req.params.id)) {
    return res.status(409).json({ error: 'An identical timetable slot already exists (same course, day, time, room, semester and section).' });
  }
  const result = await runOrFriendlyError(res, 'timetable_slots', () => run(
    `UPDATE timetable_slots SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map(c => req.body[c]), req.params.id]
  ));
  if (result === undefined) return;
  const row = await get('SELECT * FROM timetable_slots WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user, 'update', 'timetable_slots', req.params.id, req.body);
  const conflictWarnings = await describeOverlaps(row, row.id);
  res.json({ ...row, conflictWarnings });
}));

router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM timetable_slots WHERE id = ?', [req.params.id]);
  await logAudit(req.user, 'delete', 'timetable_slots', req.params.id, null);
  res.status(204).end();
}));

module.exports = router;
