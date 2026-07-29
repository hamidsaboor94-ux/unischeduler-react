const express = require('express');
const { get, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { loadTermData } = require('../loaders');
const { computeConflicts, autoResolveAll, effectiveSessionsOn, overlapsMinutes, SLOT_TIMES } = require('../scheduling');
const { candidateDates } = require('../dateUtils');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const data = await loadTermData(req.query.termId);
  res.json(computeConflicts(data));
}));

/** Rooms genuinely free at an exact day/date + time — used by the conflict-resolution card's
    "Reschedule to another room" dropdown, so it only ever offers rooms that won't just
    recreate the same clash somewhere else. `excludeSlotId`/`excludeExceptionId` leave out the
    very session being moved (otherwise it would always "clash" with its own current booking). */
router.get('/available-rooms', requireAuth, asyncHandler(async (req, res) => {
  const { termId, day, date, time, durationMinutes, excludeSlotId, excludeExceptionId } = req.query;
  if (!time || !durationMinutes) return res.status(400).json({ error: 'time and durationMinutes are required' });
  const data = await loadTermData(termId);
  const courseById = new Map(data.courses.map(c => [c.id, c]));
  const sessions = effectiveSessionsOn({ slots: data.slots, exceptions: data.exceptions, courseById, day, date })
    .filter(s => String(s.slotId) !== String(excludeSlotId) &&
      (!excludeExceptionId || String(s.exceptionId) !== String(excludeExceptionId)));
  const dur = Number(durationMinutes);
  const free = data.rooms.filter(r =>
    !sessions.some(s => s.roomId === r.id && overlapsMinutes(s.time, s.durationMinutes, time, dur)));
  res.json(free);
}));

/** Start times genuinely free for a given room (and, if the course's teacher is known, also
    free for that teacher) at an exact day/date — the "Change time" alternative. Unlike the
    room dropdown above, this checks BOTH the room and the instructor at each candidate time,
    since changing the time is meant to clear either kind of clash without opening a new one. */
router.get('/available-times', requireAuth, asyncHandler(async (req, res) => {
  const { termId, day, date, roomId, teacherId, durationMinutes, excludeSlotId, excludeExceptionId } = req.query;
  if (!roomId || !durationMinutes) return res.status(400).json({ error: 'roomId and durationMinutes are required' });
  const data = await loadTermData(termId);
  const courseById = new Map(data.courses.map(c => [c.id, c]));
  const sessions = effectiveSessionsOn({ slots: data.slots, exceptions: data.exceptions, courseById, day, date })
    .filter(s => String(s.slotId) !== String(excludeSlotId) &&
      (!excludeExceptionId || String(s.exceptionId) !== String(excludeExceptionId)));
  const dur = Number(durationMinutes);
  const rid = Number(roomId);
  const tid = teacherId ? Number(teacherId) : null;
  const free = SLOT_TIMES.filter(t => !sessions.some(s =>
    overlapsMinutes(s.time, s.durationMinutes, t, dur) && (s.roomId === rid || (tid != null && s.teacherId === tid))
  ));
  res.json(free);
}));

router.post('/auto-resolve', requireAuth, asyncHandler(async (req, res) => {
  const termId = req.body.termId || req.query.termId;
  const data = await loadTermData(termId);
  const conflicts = computeConflicts(data);
  const term = termId ? await get('SELECT * FROM terms WHERE id = ?', [termId]) : null;
  const dateOptions = candidateDates(term);
  const { slotUpdates, examUpdates, fixed } = autoResolveAll({ ...data, conflicts, dateOptions });

  for (const u of slotUpdates) {
    const sets = [];
    const params = [];
    if (u.roomId !== undefined) { sets.push('roomId = ?'); params.push(u.roomId); }
    if (u.day !== undefined) { sets.push('day = ?'); params.push(u.day); }
    if (u.time !== undefined) { sets.push('time = ?'); params.push(u.time); }
    if (sets.length) {
      params.push(u.slotId);
      await run(`UPDATE timetable_slots SET ${sets.join(', ')} WHERE id = ?`, params);
    }
  }
  for (const u of examUpdates) {
    const sets = [];
    const params = [];
    if (u.date !== undefined) { sets.push('date = ?'); params.push(u.date); }
    if (u.time !== undefined) { sets.push('time = ?'); params.push(u.time); }
    if (u.roomId !== undefined) { sets.push('roomId = ?'); params.push(u.roomId); }
    if (u.invigilatorId !== undefined) { sets.push('invigilatorId = ?'); params.push(u.invigilatorId); }
    if (sets.length) {
      params.push(u.examId);
      await run(`UPDATE exams SET ${sets.join(', ')} WHERE id = ?`, params);
    }
  }

  res.json({ fixed, slotUpdates, examUpdates });
}));

module.exports = router;
