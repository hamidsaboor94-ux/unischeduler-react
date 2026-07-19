const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { DAYS } = require('../scheduling');

const router = express.Router();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 'YYYY-MM-DD' -> 'Mon'..'Sun' (DAYS is Monday-first; Date.getDay() is Sunday-first). */
function weekdayOf(isoDate) {
  return DAYS[(new Date(isoDate + 'T00:00:00').getDay() + 6) % 7];
}

function fmt12Hour(time) {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Alerts the class's instructor that this specific date was cancelled — the one
    thing about an exception that can't wait for the instructor's next reload,
    since they may not open the app again until well after the admin's session
    ends. Silently does nothing if the course has no teacher, or the teacher has
    no login account (nowhere to deliver it) — never blocks the cancellation itself. */
async function notifyTeacherOfCancellation(slot, date) {
  const course = await get('SELECT * FROM courses WHERE id = ?', [slot.courseId]);
  if (!course || !course.teacherId) return;
  const teacher = await get('SELECT userId FROM teachers WHERE id = ?', [course.teacherId]);
  if (!teacher || !teacher.userId) return;
  const message = `Your ${course.code} — ${course.name} class on ${date} at ${fmt12Hour(slot.time)} was cancelled and should be rescheduled.`;
  await run('INSERT INTO notifications (userId, message) VALUES (?, ?)', [teacher.userId, message]);
}

// Everyone can read exceptions — students and faculty need to see cancelled/
// moved sessions on their own timetables. Rows carry no sensitive data.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json(await all('SELECT * FROM slot_exceptions'));
}));

router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { slotId, date, kind, note } = req.body;
  const slot = await get('SELECT * FROM timetable_slots WHERE id = ?', [slotId]);
  if (!slot) return res.status(404).json({ error: 'Timetable slot not found' });

  if (!ISO_DATE_RE.test(date || '')) return res.status(400).json({ error: 'A date (YYYY-MM-DD) is required' });
  if (weekdayOf(date) !== slot.day) {
    return res.status(400).json({ error: `That class meets on ${slot.day} — ${date} is a ${weekdayOf(date)}. Pick the date of an actual session.` });
  }
  if (kind !== 'cancelled' && kind !== 'rescheduled') {
    return res.status(400).json({ error: "kind must be 'cancelled' or 'rescheduled'" });
  }

  // Rescheduled sessions default any unspecified detail to the slot's own
  // value, so "same time, different room" (etc.) needs only the changed field.
  let newDate = null, newTime = null, newRoomId = null, newDurationMinutes = null;
  if (kind === 'rescheduled') {
    newDate = req.body.newDate || date;
    newTime = req.body.newTime || slot.time;
    newRoomId = req.body.newRoomId ?? slot.roomId;
    newDurationMinutes = req.body.newDurationMinutes ?? slot.durationMinutes ?? 60;
    if (!ISO_DATE_RE.test(newDate)) return res.status(400).json({ error: 'newDate must be YYYY-MM-DD' });
    if (!TIME_RE.test(newTime)) return res.status(400).json({ error: 'newTime must be HH:MM' });
    if (newDate === date && newTime === slot.time && newRoomId === slot.roomId && newDurationMinutes === (slot.durationMinutes ?? 60)) {
      return res.status(400).json({ error: 'The rescheduled session is identical to the regular one — change the date, time or room (or cancel it instead).' });
    }
  }

  let result;
  try {
    result = await run(
      `INSERT INTO slot_exceptions (slotId, date, kind, newDate, newTime, newRoomId, newDurationMinutes, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [slotId, date, kind, newDate, newTime, newRoomId, newDurationMinutes, note || null]
    );
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'This class already has an exception on that date — remove it first to change it.' });
    }
    throw err;
  }
  const row = await get('SELECT * FROM slot_exceptions WHERE id = ?', [result.id]);
  await logAudit(req.user, 'create', 'slot_exceptions', result.id, { slotId, date, kind, newDate, newTime });
  if (kind === 'cancelled') await notifyTeacherOfCancellation(slot, date);
  res.status(201).json(row);
}));

router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM slot_exceptions WHERE id = ?', [req.params.id]);
  await run('DELETE FROM slot_exceptions WHERE id = ?', [req.params.id]);
  await logAudit(req.user, 'delete', 'slot_exceptions', req.params.id, row ? { slotId: row.slotId, date: row.date, kind: row.kind } : null);
  res.status(204).end();
}));

module.exports = router;
