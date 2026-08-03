const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const asyncHandler = require('../middleware/asyncHandler');
const { DAYS } = require('../scheduling');
const { courseInScope, isScopedRequest } = require('../scope');
const { canManageCourse } = require('../ownership');
const { safeCreateNotification } = require('../notificationTypes');
const { notifyCourseStudents } = require('../notify');

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

/** Alerts the class's instructor AND every enrolled student that this specific date was
    cancelled — the one thing about an exception that can't wait for a reload, since a recipient
    may not open the app again until well after the admin's session ends. `entityType`/`entityId`
    (the slot itself, stable even after this exception row is later deleted/replaced) is what
    lets the Dashboard notice panel recognize a later reschedule of the SAME class and supersede
    this one instead of showing both forever. Silently does nothing where there's no one to
    deliver to (course has no teacher / teacher has no login account) — never blocks the
    cancellation itself. */
async function notifyOfCancellation(slot, date) {
  const course = await get('SELECT * FROM courses WHERE id = ?', [slot.courseId]);
  if (!course) return;
  const message = `Your ${course.code} — ${course.name} class on ${date} at ${fmt12Hour(slot.time)} was cancelled and should be rescheduled.`;
  const meta = { courseId: course.id, entityType: 'timetable_slot', entityId: slot.id };
  if (course.teacherId) {
    const teacher = await get('SELECT userId FROM teachers WHERE id = ?', [course.teacherId]);
    if (teacher && teacher.userId) await safeCreateNotification(teacher.userId, message, 'class_cancelled', meta);
  }
  await notifyCourseStudents(course.id, message, { type: 'class_cancelled', ...meta });
}

/** Same audience as notifyOfCancellation, fired when that (or any) occurrence of this slot is
    given a new date/time/room. Shares the same entityType/entityId (the slot) so the Dashboard
    groups this with any earlier cancellation notice for the same class and shows only this,
    newer one — the notice "updates" rather than doubling up. */
async function notifyOfReschedule(slot, { newDate, newTime, newRoomId }) {
  const course = await get('SELECT * FROM courses WHERE id = ?', [slot.courseId]);
  if (!course) return;
  const room = newRoomId ? await get('SELECT name FROM rooms WHERE id = ?', [newRoomId]) : null;
  const message = `Your ${course.code} — ${course.name} class has been rescheduled to ${newDate} at ${fmt12Hour(newTime)}${room ? `, ${room.name}` : ''}.`;
  const meta = { courseId: course.id, entityType: 'timetable_slot', entityId: slot.id };
  if (course.teacherId) {
    const teacher = await get('SELECT userId FROM teachers WHERE id = ?', [course.teacherId]);
    if (teacher && teacher.userId) await safeCreateNotification(teacher.userId, message, 'class_rescheduled', meta);
  }
  await notifyCourseStudents(course.id, message, { type: 'class_rescheduled', ...meta });
}

/** A cancelled session can also be resolved by simply removing the exception (restoring the
    normal weekly schedule) rather than rescheduling it — with no later notification to supersede
    the cancellation notice in that case, it would otherwise nag forever. Marks it read instead of
    deleting it, consistent with how every other notification is dismissed in this app. */
async function resolveCancellationNotifications(slot) {
  const course = await get('SELECT * FROM courses WHERE id = ?', [slot.courseId]);
  if (!course) return;
  const recipientIds = [];
  if (course.teacherId) {
    const teacher = await get('SELECT userId FROM teachers WHERE id = ?', [course.teacherId]);
    if (teacher && teacher.userId) recipientIds.push(teacher.userId);
  }
  const students = await all(`SELECT studentId FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [course.id]);
  recipientIds.push(...students.map(s => s.studentId));
  if (!recipientIds.length) return;
  const placeholders = recipientIds.map(() => '?').join(',');
  await run(
    `UPDATE notifications SET isRead = 1
     WHERE type = 'class_cancelled' AND entityType = 'timetable_slot' AND entityId = ? AND userId IN (${placeholders})`,
    [slot.id, ...recipientIds]
  );
}

// Everyone with 'timetable' read access can read exceptions — students and faculty need to see
// cancelled/moved sessions on their own timetables. Rows carry no sensitive data. (Same
// requirement the old mount-level requireModuleAccess('timetable') enforced for this path.)
router.get('/', requireAuth, requirePermission('timetable', 'read'), asyncHandler(async (req, res) => {
  res.json(await all('SELECT * FROM slot_exceptions'));
}));

// General-purpose cancel/move, still requiring 'timetable' write (registrar/dean/dept_head) —
// unchanged from before, faculty/student still can't reach this (their 'timetable' access is
// read-only). The one exception carved out for faculty is the narrowly-scoped PUT
// /:id/reschedule route below, which does NOT require 'timetable' write.
router.post('/', requireAuth, requirePermission('timetable', 'write'), asyncHandler(async (req, res) => {
  const { slotId, date, kind, note } = req.body;
  const slot = await get('SELECT * FROM timetable_slots WHERE id = ?', [slotId]);
  if (!slot) return res.status(404).json({ error: 'Timetable slot not found' });
  // Department-scoped roles may only alter sessions of their own courses.
  if (isScopedRequest(req) && !(await courseInScope(req, slot.courseId))) {
    return res.status(403).json({ error: 'You can only manage sessions for courses in your own department.' });
  }

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
  if (kind === 'cancelled') await notifyOfCancellation(slot, date);
  if (kind === 'rescheduled') await notifyOfReschedule(slot, { newDate, newTime, newRoomId });
  res.status(201).json(row);
}));

/** Narrowly-scoped faculty action: turn ONE already-cancelled session into a rescheduled one.
    Unlike POST/DELETE above (open to any authenticated user, department-scope only), this route
    is the one place a faculty member can write to slot_exceptions at all, and only under both
    conditions at once — (a) they teach the course this slot belongs to (canManageCourse, same
    ownership check used for assignments/attendance/gradebook), and (b) the target row is
    currently 'cancelled'. It writes only this row's kind/newDate/newTime/newRoomId/
    newDurationMinutes — never the slot, the course, another exception, or an exam. */
router.put('/:id/reschedule', requireAuth, requireRole('admin', 'faculty'), asyncHandler(async (req, res) => {
  const exception = await get('SELECT * FROM slot_exceptions WHERE id = ?', [req.params.id]);
  if (!exception) return res.status(404).json({ error: 'Not found' });
  if (exception.kind !== 'cancelled') {
    return res.status(400).json({ error: 'Only a cancelled session can be rescheduled through this action.' });
  }

  const slot = await get('SELECT * FROM timetable_slots WHERE id = ?', [exception.slotId]);
  if (!slot) return res.status(404).json({ error: 'Timetable slot not found' });
  const course = await get('SELECT * FROM courses WHERE id = ?', [slot.courseId]);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (!(await canManageCourse(req, course))) {
    return res.status(403).json({ error: 'You do not have access to this course.' });
  }

  const newDate = req.body.newDate || exception.date;
  const newTime = req.body.newTime || slot.time;
  const newRoomId = req.body.newRoomId ?? slot.roomId;
  const newDurationMinutes = slot.durationMinutes ?? 60;
  if (!ISO_DATE_RE.test(newDate)) return res.status(400).json({ error: 'newDate must be YYYY-MM-DD' });
  if (!TIME_RE.test(newTime)) return res.status(400).json({ error: 'newTime must be HH:MM' });

  await run(
    `UPDATE slot_exceptions SET kind = 'rescheduled', newDate = ?, newTime = ?, newRoomId = ?, newDurationMinutes = ? WHERE id = ?`,
    [newDate, newTime, newRoomId, newDurationMinutes, exception.id]
  );
  const row = await get('SELECT * FROM slot_exceptions WHERE id = ?', [exception.id]);
  await logAudit(req.user, 'update', 'slot_exceptions', exception.id, { kind: 'rescheduled', newDate, newTime, newRoomId });
  await notifyOfReschedule(slot, { newDate, newTime, newRoomId });
  res.json(row);
}));

router.delete('/:id', requireAuth, requirePermission('timetable', 'write'), asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM slot_exceptions WHERE id = ?', [req.params.id]);
  if (isScopedRequest(req)) {
    const slot = row ? await get('SELECT courseId FROM timetable_slots WHERE id = ?', [row.slotId]) : null;
    if (!slot || !(await courseInScope(req, slot.courseId))) {
      return res.status(404).json({ error: 'Not found' });
    }
  }
  await run('DELETE FROM slot_exceptions WHERE id = ?', [req.params.id]);
  await logAudit(req.user, 'delete', 'slot_exceptions', req.params.id, row ? { slotId: row.slotId, date: row.date, kind: row.kind } : null);
  if (row && row.kind === 'cancelled') {
    const slot = await get('SELECT * FROM timetable_slots WHERE id = ?', [row.slotId]);
    if (slot) await resolveCancellationNotifications(slot);
  }
  res.status(204).end();
}));

module.exports = router;
