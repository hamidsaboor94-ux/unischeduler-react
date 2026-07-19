/**
 * Scheduling/conflict engine, ported from Desktop/Html Project/script.js.
 * Pure functions only — no DB access here. Callers load term-scoped rows
 * from SQLite, pass them in, and persist whatever updates come back.
 */

const EXAM_DURATION_HOURS = 2;
const TIMES = ['08:00', '10:00', '12:00', '14:00', '16:00'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Half-hour candidate start times used when auto-resolving timetable slots
// (which, unlike exams, can start at any time — this is just a reasonable
// search grid, not a hard constraint on what a slot's start time can be).
const SLOT_TIMES = (() => {
  const list = [];
  for (let h = 7; h <= 20; h++) {
    list.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 20) list.push(`${String(h).padStart(2, '0')}:30`);
  }
  return list;
})();

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function addMinutes(time, mins) {
  const total = timeToMinutes(time) + mins;
  const hh = Math.floor(total / 60) % 24, mm = ((total % 60) + 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function addHours(time, h) {
  return addMinutes(time, h * 60);
}
/** Duration-in-minutes overlap check — the primitive everything else is built on. */
function overlapsMinutes(aStart, aDurMin, bStart, bDurMin) {
  const as = timeToMinutes(aStart), ae = as + aDurMin;
  const bs = timeToMinutes(bStart), be = bs + bDurMin;
  return as < be && bs < ae;
}
/** Back-compat wrapper for callers still working in hours (exams use a fixed 2-hour duration). */
function overlaps(aStart, aDurHours, bStart, bDurHours) {
  return overlapsMinutes(aStart, aDurHours * 60, bStart, bDurHours * 60);
}
function intersect(a, b) {
  const set = new Set(a);
  return b.filter(x => set.has(x));
}

/**
 * Groups items that pairwise-or-transitively overlap in time within the same
 * resource+day bucket. `resourceKeyFn(item)` returns a bucket key (e.g. a
 * room or teacher id scoped to a day) or null/undefined to exclude the item.
 * `durationFn(item)` returns its duration in minutes. Returns an array of
 * groups (each an array of >=2 overlapping items).
 */
function clusterOverlapping(items, resourceKeyFn, timeFn, durationFn) {
  const byResource = new Map();
  items.forEach((item, idx) => {
    const key = resourceKeyFn(item);
    if (key == null) return;
    if (!byResource.has(key)) byResource.set(key, []);
    byResource.get(key).push(idx);
  });

  const groups = [];
  byResource.forEach(indices => {
    if (indices.length < 2) return;
    const parent = indices.map((_, i) => i);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const a = items[indices[i]], b = items[indices[j]];
        if (overlapsMinutes(timeFn(a), durationFn(a), timeFn(b), durationFn(b))) union(i, j);
      }
    }
    const clusters = new Map();
    indices.forEach((itemIdx, i) => {
      const root = find(i);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(items[itemIdx]);
    });
    clusters.forEach(group => { if (group.length > 1) groups.push(group); });
  });
  return groups;
}

/**
 * Returns the sessions that actually occur on a given weekday (`day`) or, if `date` is given,
 * on that specific calendar date — the same "what really happens that day" reasoning as
 * computeConflicts's section 1c, factored out so a reschedule UI can ask "is this room/teacher
 * free at this exact day+time" without duplicating the exception-suppression logic inline.
 * - Day-only (no date): the recurring weekly picture — every slot meeting that weekday.
 * - With date: regular slots meeting that weekday MINUS any cancelled/moved-away that date,
 *   PLUS any session (including this one) that was moved IN to land on that date.
 * Each returned item is `{slotId, exceptionId, courseId, teacherId, roomId, time, durationMinutes}`
 * — exceptionId is null for a plain recurring slot, or the slot_exceptions.id for a moved-in one.
 */
function effectiveSessionsOn({ slots, exceptions, courseById, day, date }) {
  const slotDuration = (s) => s.durationMinutes || 60;
  const toSession = (s) => ({
    slotId: s.id, exceptionId: null, courseId: s.courseId,
    teacherId: courseById.get(s.courseId)?.teacherId ?? null,
    roomId: s.roomId, time: s.time, durationMinutes: slotDuration(s)
  });

  if (!date) return slots.filter(s => s.day === day).map(toSession);

  const slotById = new Map(slots.map(s => [s.id, s]));
  const relevant = exceptions.filter(x => slotById.has(x.slotId));
  const suppressed = new Set(relevant.map(x => `${x.slotId}|${x.date}`));
  const weekday = DAYS[(new Date(date + 'T00:00:00').getDay() + 6) % 7];

  const regular = slots
    .filter(s => s.day === weekday && !suppressed.has(`${s.id}|${date}`))
    .map(toSession);
  const movedIn = relevant
    .filter(x => x.kind === 'rescheduled' && x.newDate === date)
    .map(x => {
      const slot = slotById.get(x.slotId);
      return {
        slotId: x.slotId, exceptionId: x.id, courseId: slot.courseId,
        teacherId: courseById.get(slot.courseId)?.teacherId ?? null,
        roomId: x.newRoomId ?? slot.roomId, time: x.newTime,
        durationMinutes: x.newDurationMinutes || slot.durationMinutes || 60
      };
    });
  return [...regular, ...movedIn];
}

/**
 * courses: [{id, code, teacherId, ...}]
 * slots: [{id, day, time, roomId, courseId}]
 * exams: [{id, courseId, date, time, roomId, invigilatorId}]
 * rooms: [{id, name, capacity}]
 * teachers: [{id, name, ...}]
 * enrollmentsByCourse: Map<courseId, studentId[]> (status='enrolled' only)
 * exceptions: [{id, slotId, date, kind, newDate, newTime, newRoomId, newDurationMinutes}]
 *   — one-off cancellations/reschedules of single dated occurrences
 */
function computeConflicts({ courses, slots, exams, rooms, teachers, enrollmentsByCourse, exceptions = [] }) {
  const courseById = new Map(courses.map(c => [c.id, c]));
  const roomById = new Map(rooms.map(r => [r.id, r]));
  const teacherById = new Map((teachers || []).map(t => [t.id, t]));
  const enrolledCount = (courseId) => (enrollmentsByCourse.get(courseId) || []).length;

  const critical = [];
  const warnings = [];
  const notices = [];

  const slotDuration = (s) => s.durationMinutes || 60;
  const timeRangeLabel = (group) => group
    .map(s => `${s.time}–${addMinutes(s.time, slotDuration(s))}`)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', ');

  // 0. Duplicate/redundant entries — the SAME course with two overlapping meeting times on
  // the same day (full overlap, partial overlap, or one fully inside the other). In this
  // schema a course has exactly one teacherId, so two overlapping slots of the same course
  // can never be a legitimate "two different sections, two different instructors" situation
  // — it's always either a literal duplicate row or a real instructor/room double-booking of
  // the same class, both of which are data-entry mistakes worth flagging distinctly from the
  // cross-course conflicts below (so an admin knows to check for a duplicate, not move a class).
  const byCourseDay = new Map();
  slots.forEach(s => {
    const key = `${s.courseId}|${s.day}`;
    if (!byCourseDay.has(key)) byCourseDay.set(key, []);
    byCourseDay.get(key).push(s);
  });
  const reportedDuplicatePairs = new Set();
  byCourseDay.forEach(group => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (!overlapsMinutes(a.time, slotDuration(a), b.time, slotDuration(b))) continue;
        const pairKey = [a.id, b.id].sort((x, y) => x - y).join(',');
        if (reportedDuplicatePairs.has(pairKey)) continue;
        reportedDuplicatePairs.add(pairKey);
        const course = courseById.get(a.courseId);
        const sameRoom = a.roomId != null && a.roomId === b.roomId;
        const roomLabel = sameRoom ? ` in ${roomById.get(a.roomId)?.name || 'the same room'}` : '';
        critical.push({
          type: 'duplicate-slot', day: a.day, roomId: sameRoom ? a.roomId : null,
          slotIds: [a.id, b.id], courseIds: [a.courseId], codes: [course?.code || a.courseId],
          title: 'Likely duplicate timetable entry',
          desc: `${course?.code || 'This course'} has two overlapping sessions on ${a.day}` +
            ` (${a.time}–${addMinutes(a.time, slotDuration(a))} and ${b.time}–${addMinutes(b.time, slotDuration(b))})` +
            `${roomLabel} — check whether this is a duplicate/data-entry mistake.`
        });
      }
    }
  });

  // 1. Room double-booking — overlapping time ranges in the same room on the same day,
  // between two DIFFERENT courses (a same-course overlap is reported above instead).
  const roomGroups = clusterOverlapping(
    slots,
    s => `${s.day}|${s.roomId}`,
    s => s.time,
    slotDuration
  );
  roomGroups.forEach(group => {
    const courseIds = [...new Set(group.map(g => g.courseId))];
    if (courseIds.length < 2) return; // same-course overlap — reported as duplicate-slot above instead
    const day = group[0].day;
    const roomId = group[0].roomId;
    const affected = courseIds.reduce((n, id) => n + enrolledCount(id), 0);
    const codes = courseIds.map(id => courseById.get(id)?.code || id);
    critical.push({
      type: 'room-double-booking', day, roomId,
      slotIds: group.map(g => g.id), courseIds, codes,
      title: 'Room double-booking',
      desc: `${roomById.get(roomId)?.name || 'Room'} has overlapping bookings for ${codes.join(' & ')} on ${day} (${timeRangeLabel(group)}). Affects up to ${affected} students.`
    });
  });

  // 1b. Instructor double-booking — same teacher assigned to two different
  // courses with overlapping meeting times, regardless of room.
  const teacherGroups = clusterOverlapping(
    slots,
    s => {
      const teacherId = courseById.get(s.courseId)?.teacherId;
      return teacherId == null ? null : `${s.day}|${teacherId}`;
    },
    s => s.time,
    slotDuration
  );
  teacherGroups.forEach(group => {
    const courseIds = [...new Set(group.map(g => g.courseId))];
    if (courseIds.length < 2) return;
    const day = group[0].day;
    const teacherId = courseById.get(group[0].courseId).teacherId;
    const affected = courseIds.reduce((n, id) => n + enrolledCount(id), 0);
    const codes = courseIds.map(id => courseById.get(id)?.code || id);
    critical.push({
      type: 'instructor-double-booking', day, teacherId,
      slotIds: group.map(g => g.id), courseIds, codes,
      title: 'Instructor double-booking',
      desc: `${teacherById.get(teacherId)?.name || 'Instructor'} is assigned to teach both ${codes.join(' & ')} on ${day} (${timeRangeLabel(group)}). Affects up to ${affected} students.`
    });
  });

  // 1c. One-off rescheduled sessions — each moved occurrence is a dated,
  // non-recurring event, so it's checked against what actually happens on its
  // NEW date: regular classes meeting that weekday (minus any occurrence that
  // is itself cancelled or moved away that same date — including the moved
  // session's own original slot, which by definition doesn't meet that day)
  // plus any other moved sessions landing on the same date. The recurring
  // room/teacher checks above intentionally ignore exceptions: cancelling or
  // moving ONE week never fixes a clash that repeats every other week.
  {
    const slotById = new Map(slots.map(s => [s.id, s]));
    const relevant = exceptions.filter(x => slotById.has(x.slotId));
    // Occurrences that don't take place on their regular day that date.
    const suppressed = new Set(relevant.map(x => `${x.slotId}|${x.date}`));
    const dayOfDate = (iso) => DAYS[(new Date(iso + 'T00:00:00').getDay() + 6) % 7];

    const movedSessions = relevant
      .filter(x => x.kind === 'rescheduled' && x.newDate && x.newTime)
      .map(x => {
        const slot = slotById.get(x.slotId);
        return {
          exceptionId: x.id, slotId: x.slotId, courseId: slot.courseId,
          teacherId: courseById.get(slot.courseId)?.teacherId ?? null,
          date: x.newDate, time: x.newTime,
          durationMinutes: x.newDurationMinutes || slot.durationMinutes || 60,
          roomId: x.newRoomId ?? slot.roomId
        };
      });

    const pushMovedClash = (m, other, sharedRoom, sharedTeacher, otherLabel) => {
      const code = courseById.get(m.courseId)?.code || `course ${m.courseId}`;
      const otherCode = courseById.get(other.courseId)?.code || `course ${other.courseId}`;
      const range = `${m.time}–${addMinutes(m.time, m.durationMinutes)}`;
      if (sharedRoom) {
        critical.push({
          type: 'moved-session-room-clash', date: m.date, roomId: m.roomId,
          exceptionId: m.exceptionId, slotIds: [m.slotId, other.slotId ?? other.id].filter(Boolean),
          courseIds: [m.courseId, other.courseId], codes: [code, otherCode],
          title: 'Moved session room clash',
          desc: `${code}'s session moved to ${m.date} (${range}) double-books ${roomById.get(m.roomId)?.name || 'its room'} with ${otherLabel} ${otherCode}.`
        });
      }
      if (sharedTeacher) {
        critical.push({
          type: 'moved-session-instructor-clash', date: m.date, teacherId: m.teacherId,
          exceptionId: m.exceptionId, slotIds: [m.slotId, other.slotId ?? other.id].filter(Boolean),
          courseIds: [m.courseId, other.courseId], codes: [code, otherCode],
          title: 'Moved session instructor clash',
          desc: `${teacherById.get(m.teacherId)?.name || 'The instructor'} has ${code}'s session moved to ${m.date} (${range}) overlapping ${otherLabel} ${otherCode}.`
        });
      }
    };

    movedSessions.forEach(m => {
      const weekday = dayOfDate(m.date);
      slots.forEach(s => {
        if (s.day !== weekday) return;
        if (s.id === m.slotId) return; // replaces its own original occurrence
        if (suppressed.has(`${s.id}|${m.date}`)) return; // that class doesn't meet that date either
        if (s.courseId === m.courseId) return; // same-course overlap isn't a conflict (matches rule 1)
        if (!overlapsMinutes(s.time, slotDuration(s), m.time, m.durationMinutes)) return;
        const sTeacher = courseById.get(s.courseId)?.teacherId;
        pushMovedClash(
          m, { slotId: s.id, courseId: s.courseId },
          m.roomId != null && s.roomId === m.roomId,
          m.teacherId != null && sTeacher === m.teacherId,
          'the regular class'
        );
      });
    });

    for (let i = 0; i < movedSessions.length; i++) {
      for (let j = i + 1; j < movedSessions.length; j++) {
        const a = movedSessions[i], b = movedSessions[j];
        if (a.date !== b.date || a.courseId === b.courseId) continue;
        if (!overlapsMinutes(a.time, a.durationMinutes, b.time, b.durationMinutes)) continue;
        pushMovedClash(
          a, { slotId: b.slotId, courseId: b.courseId },
          a.roomId != null && a.roomId === b.roomId,
          a.teacherId != null && a.teacherId === b.teacherId,
          'the also-moved session of'
        );
      }
    }
  }

  // 2. Student exam clashes (same date + overlapping time window, shared students)
  const examDuration = (e) => e.durationMinutes || EXAM_DURATION_HOURS * 60;
  const scheduledExams = exams.filter(e => e.date && e.time);
  for (let i = 0; i < scheduledExams.length; i++) {
    for (let j = i + 1; j < scheduledExams.length; j++) {
      const a = scheduledExams[i], b = scheduledExams[j];
      if (a.date !== b.date) continue;
      if (!overlapsMinutes(a.time, examDuration(a), b.time, examDuration(b))) continue;
      const shared = intersect(enrollmentsByCourse.get(a.courseId) || [], enrollmentsByCourse.get(b.courseId) || []);
      if (shared.length > 0) {
        warnings.push({
          type: 'exam-clash', examIds: [a.id, b.id], courseIds: [a.courseId, b.courseId],
          codes: [courseById.get(a.courseId)?.code, courseById.get(b.courseId)?.code],
          studentIds: shared,
          title: 'Student exam clash',
          desc: `${shared.length} students enrolled in both ${courseById.get(a.courseId)?.code} and ${courseById.get(b.courseId)?.code}. Both exams are ${a.date}, ${a.time}–${addMinutes(a.time, examDuration(a))}.`
        });
      }
    }
  }

  // 3. Capacity exceeded
  scheduledExams.forEach(e => {
    const room = roomById.get(e.roomId);
    const count = enrolledCount(e.courseId);
    if (room && count > room.capacity) {
      warnings.push({
        type: 'capacity', examId: e.id, courseIds: [e.courseId], codes: [courseById.get(e.courseId)?.code],
        title: 'Capacity exceeded',
        desc: `${courseById.get(e.courseId)?.code} exam on ${e.date} has ${count} registered students. ${room.name} capacity is ${room.capacity}. ${count - room.capacity} students cannot be seated.`
      });
    }
  });

  // 4. Invigilator shortage
  const missing = scheduledExams.filter(e => !e.invigilatorId);
  if (missing.length > 0) {
    notices.push({
      type: 'invigilator-shortage', examIds: missing.map(e => e.id),
      codes: missing.map(e => courseById.get(e.courseId)?.code),
      title: 'Invigilator shortage',
      desc: `${missing.length} exam slot${missing.length > 1 ? 's' : ''} (${missing.map(e => courseById.get(e.courseId)?.code).join(', ')}) ${missing.length > 1 ? 'have' : 'has'} no assigned invigilator yet.`
    });
  }

  return { critical, warnings, notices };
}

// Matches the frontend's slotSession() (utils.js) — a class is "Morning" or "Evening" purely by
// time of day. Used so an exam prefers a slot in its own course's session: an Evening-program
// course's students/teacher are only realistically on campus in the evening, so scheduling its
// exam at 8am (even though nothing else technically clashes) would be a real-world mistake.
const SESSION_CUTOFF_MINUTES = 14 * 60;
function sessionOf(time) { return timeToMinutes(time) < SESSION_CUTOFF_MINUTES ? 'Morning' : 'Evening'; }

/**
 * Returns { updates, unresolved } for every previously-unscheduled exam (optionally restricted
 * to `examType`; exams of other types are left completely untouched, but still counted against
 * for room/student/invigilator clashes since a booking is a booking regardless of exam type).
 * `updates` is [{examId, date, time, roomId, invigilatorId}] for every exam it could place
 * without creating a room, student, or invigilator clash. `unresolved` is
 * [{examId, courseId, reason}] for exams it couldn't place at all, with a human-readable
 * reason (no room big enough, or no conflict-free slot within the exam period) so the caller
 * can surface exactly what still needs manual attention. Does not mutate its inputs — the
 * caller persists the returned updates.
 */
function autoScheduleAll({ exams, rooms, teachers = [], slots = [], enrollmentsByCourse, dateOptions, times = TIMES, examType }) {
  const updates = [];
  const unresolved = [];
  const working = exams.map(e => ({ ...e }));
  const unscheduled = working.filter(e => !e.date && (!examType || e.type === examType));
  const durationOf = (e) => e.durationMinutes || EXAM_DURATION_HOURS * 60;

  // A course's own weekly class slot determines its session — take the first slot found per
  // course (a course isn't expected to have slots split across sessions in practice).
  const sessionByCourse = new Map();
  slots.forEach(s => { if (!sessionByCourse.has(s.courseId)) sessionByCourse.set(s.courseId, sessionOf(s.time)); });

  // Flatten date x time into one grid and rotate the starting point after each successful
  // placement, so consecutive exams spread across the whole exam period instead of every exam
  // greedily piling onto the very first day/time slot it can legally use. A pure first-fit
  // search is "correct" (no clashes) but produces an unrealistic schedule — cramming everything
  // into day one starves that day's limited invigilator pool while the rest of the exam period
  // sits completely empty.
  const grid = [];
  for (const date of dateOptions) for (const time of times) grid.push({ date, time });
  let cursor = 0;

  unscheduled.forEach(exam => {
    const enrolled = enrollmentsByCourse.get(exam.courseId) || [];
    const needed = enrolled.length;
    const duration = durationOf(exam);
    const candidateRooms = rooms.filter(r => r.capacity >= needed).sort((a, b) => a.capacity - b.capacity);
    if (!candidateRooms.length) {
      const biggest = rooms.reduce((max, r) => Math.max(max, r.capacity || 0), 0);
      unresolved.push({
        examId: exam.id, courseId: exam.courseId,
        reason: rooms.length
          ? `No room has enough capacity for ${needed} enrolled student${needed === 1 ? '' : 's'} (the largest room seats ${biggest}).`
          : 'No rooms exist to schedule an exam in.'
      });
      return;
    }

    const preferredSession = sessionByCourse.get(exam.courseId) || null;
    let placed = false;

    // First pass: only grid slots matching the course's own session (skipped entirely when the
    // course has no timetabled session yet). Second pass: any slot at all, so an exam still gets
    // scheduled rather than left unresolved just because its preferred session is fully booked.
    for (const requireSameSession of preferredSession ? [true, false] : [false]) {
      for (let step = 0; step < grid.length && !placed; step++) {
        const { date, time } = grid[(cursor + step) % grid.length];
        if (requireSameSession && sessionOf(time) !== preferredSession) continue;
        for (const room of candidateRooms) {
          const clashesRoom = working.some(e => e.id !== exam.id && e.date === date && e.roomId === room.id &&
            overlapsMinutes(e.time, durationOf(e), time, duration));
          if (clashesRoom) continue;
          const clashesStudents = working.some(e => {
            if (e.id === exam.id) return false;
            if (e.date !== date || !overlapsMinutes(e.time, durationOf(e), time, duration)) return false;
            return intersect(enrollmentsByCourse.get(e.courseId) || [], enrolled).length > 0;
          });
          if (clashesStudents) continue;
          exam.date = date; exam.time = time; exam.roomId = room.id;
          const busyInvigilators = new Set(working
            .filter(e => e.id !== exam.id && e.date === date && e.invigilatorId != null &&
              overlapsMinutes(e.time, durationOf(e), time, duration))
            .map(e => e.invigilatorId));
          const invigilator = teachers.find(t => !busyInvigilators.has(t.id));
          exam.invigilatorId = invigilator ? invigilator.id : null;
          updates.push({ examId: exam.id, date, time, roomId: room.id, invigilatorId: exam.invigilatorId });
          placed = true;
          cursor = (cursor + step + 1) % grid.length;
          break;
        }
      }
    }
    if (!placed) {
      unresolved.push({
        examId: exam.id, courseId: exam.courseId,
        reason: `No conflict-free date/time/room combination found within the exam period (checked ${dateOptions.length} day${dateOptions.length === 1 ? '' : 's'} × ${times.length} time${times.length === 1 ? '' : 's'}).`
      });
    }
  });

  return { updates, unresolved };
}

/**
 * Returns { slotUpdates, examUpdates, fixed } describing the changes that
 * would resolve as many of the given conflicts as possible. Does not mutate
 * its inputs — the caller persists the returned updates.
 */
function autoResolveAll({ conflicts, courses, slots, rooms, exams, enrollmentsByCourse, teachers, dateOptions, times = TIMES }) {
  const { critical, warnings, notices } = conflicts;
  const courseById = new Map((courses || []).map(c => [c.id, c]));
  const slotUpdates = [];
  const examUpdates = new Map();
  let fixed = 0;

  const workingSlots = slots.map(s => ({ ...s }));
  const workingExams = exams.map(e => ({ ...e }));

  function getExamUpdate(examId) {
    if (!examUpdates.has(examId)) examUpdates.set(examId, { examId });
    return examUpdates.get(examId);
  }

  const slotDuration = (s) => s.durationMinutes || 60;

  critical.forEach(c => {
    if (c.type === 'room-double-booking') {
      const movable = c.slotIds.slice(1);
      movable.forEach(slotId => {
        const slot = workingSlots.find(s => s.id === slotId);
        if (!slot) return;
        const freeRoom = rooms.find(r => r.id !== slot.roomId &&
          !workingSlots.some(s2 => s2.id !== slot.id && s2.day === slot.day && s2.roomId === r.id &&
            overlapsMinutes(s2.time, slotDuration(s2), slot.time, slotDuration(slot))));
        if (freeRoom) {
          slot.roomId = freeRoom.id;
          slotUpdates.push({ slotId, roomId: freeRoom.id });
          fixed++;
        }
      });
    } else if (c.type === 'instructor-double-booking') {
      const movable = c.slotIds.slice(1);
      movable.forEach(slotId => {
        const slot = workingSlots.find(s => s.id === slotId);
        if (!slot) return;
        const duration = slotDuration(slot);
        outer:
        for (const day of DAYS) {
          for (const time of SLOT_TIMES) {
            if (day === slot.day && time === slot.time) continue;
            const teacherBusy = workingSlots.some(s2 => s2.id !== slot.id && s2.day === day &&
              courseById.get(s2.courseId)?.teacherId === c.teacherId &&
              overlapsMinutes(s2.time, slotDuration(s2), time, duration));
            if (teacherBusy) continue;
            const roomBusy = workingSlots.some(s2 => s2.id !== slot.id && s2.day === day && s2.roomId === slot.roomId &&
              overlapsMinutes(s2.time, slotDuration(s2), time, duration));
            if (roomBusy) continue;
            slot.day = day; slot.time = time;
            slotUpdates.push({ slotId, day, time });
            fixed++;
            break outer;
          }
        }
      });
    }
  });

  warnings.forEach(w => {
    if (w.type === 'exam-clash') {
      const examToMove = workingExams.find(e => e.id === w.examIds[1]);
      const other = workingExams.find(e => e.id === w.examIds[0]);
      const durationOf = (e) => e.durationMinutes || EXAM_DURATION_HOURS * 60;
      const moveDuration = durationOf(examToMove);
      const dates = [...dateOptions, examToMove.date];
      let resolved = false;
      for (const date of dates) {
        for (const time of times) {
          if (date === other.date && overlapsMinutes(time, moveDuration, other.time, durationOf(other))) continue;
          const clash = workingExams.some(e => e.id !== examToMove.id && e.date === date &&
            overlapsMinutes(e.time, durationOf(e), time, moveDuration) &&
            intersect(enrollmentsByCourse.get(e.courseId) || [], enrollmentsByCourse.get(examToMove.courseId) || []).length > 0);
          if (clash) continue;
          examToMove.date = date; examToMove.time = time;
          Object.assign(getExamUpdate(examToMove.id), { date, time });
          fixed++; resolved = true;
          break;
        }
        if (resolved) break;
      }
    } else if (w.type === 'capacity') {
      const exam = workingExams.find(e => e.id === w.examId);
      const needed = (enrollmentsByCourse.get(exam.courseId) || []).length;
      const bigger = rooms.filter(r => r.capacity >= needed).sort((a, b) => a.capacity - b.capacity)[0];
      if (bigger) {
        exam.roomId = bigger.id;
        Object.assign(getExamUpdate(exam.id), { roomId: bigger.id });
        fixed++;
      }
    }
  });

  notices.forEach(n => {
    if (n.type === 'invigilator-shortage') {
      n.examIds.forEach(examId => {
        const exam = workingExams.find(e => e.id === examId);
        const busy = new Set(workingExams.filter(e => e.date === exam.date && e.time === exam.time && e.invigilatorId).map(e => e.invigilatorId));
        const free = teachers.find(t => !busy.has(t.id));
        if (free) {
          exam.invigilatorId = free.id;
          Object.assign(getExamUpdate(exam.id), { invigilatorId: free.id });
          fixed++;
        }
      });
    }
  });

  return { slotUpdates, examUpdates: [...examUpdates.values()], fixed };
}

module.exports = {
  EXAM_DURATION_HOURS, TIMES, DAYS, SLOT_TIMES,
  timeToMinutes, addMinutes, overlaps, overlapsMinutes, addHours, intersect, clusterOverlapping,
  computeConflicts, autoScheduleAll, autoResolveAll, effectiveSessionsOn
};
