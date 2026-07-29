import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { deleteSlot, saveSlotException, deleteSlotException } from '../api.js';
import { DAYS, courseColor, courseById, roomName, teacherName, timeToMinutes, addMinutes, fmt12Hour, fmtDate, isoDateLocal } from '../utils.js';

/** One icon-over-label button in a course card's quick-action footer row. `dot` marks it with a
    small unread/attention indicator (e.g. unviewed assignment, active conflict); `disabled` dims
    it and suppresses the click (e.g. Conflicts when this session has none). */
function QuickAction({ icon, label, onClick, dot = false, dotDanger = false, disabled = false }) {
  return (
    <button
      type="button"
      className={'slot-quick-action' + (disabled ? ' disabled' : '')}
      disabled={disabled}
      onClick={disabled ? undefined : (e) => { e.stopPropagation(); onClick(); }}
    >
      {dot && <span className={'slot-quick-action-dot' + (dotDanger ? ' danger' : '')}></span>}
      <i className={'ti ' + icon} aria-hidden="true"></i>
      <span className="slot-quick-action-label">{label}</span>
    </button>
  );
}

/** Port of renderCalendar() — shared by the Timetable and My Schedule pages. A same-size card per
    class, listed under its day in start-time order (no time-proportional positioning, so
    overlapping/duplicate slots never overlap visually — they just stack).

    When `weekDates` ({ Mon: 'YYYY-MM-DD', ... }) is given, the calendar becomes date-aware:
    day headers show real dates and one-off `exceptions` are reflected — a cancelled occurrence
    turns light red with a "Cancelled" badge, a rescheduled one turns blue on its original day
    ("Moved away") and appears as an extra blue card on its new date ("Moved in"). Every card on a
    dated occurrence gets a persistent, labeled quick-action footer row (`quickActionsFor`),
    role-specific — admin gets Edit/Move/Cancel/Conflicts, faculty gets Assign/Attendance/Marks/
    Roster, students get Attendance/Assignments/Materials/Grades; a card that already has an
    exception gets an "Undo" action instead (admin only). Without `weekDates` it renders the plain
    recurring week exactly as before, with no quick actions. */
export default function WeeklyCalendar({
  slotsToShow, conflictSlotIds, editable = false,
  showLecturer = true, showSemesterBadge = false, dayFilter = '',
  weekDates = null, exceptions = [], onCardClick = null, unviewedCourseIds = null,
  conflictIssueBySlotId = null, finalGradesByCourseId = null,
}) {
  const { t } = useTranslation(['timetable', 'common']);
  const { currentUser, courses, rooms, teachers, afterMutate } = useAppData();
  const { openModal, confirmAction } = useModal();
  const { showSection } = useNavigation();

  const today = isoDateLocal(new Date());
  const shownSlotIds = new Set(slotsToShow.map(s => s.id));

  function cancelThisDate(slot, course, dateFor) {
    confirmAction(
      t('timetable:weeklyCalendar.cancelConfirm', {
        code: course.code, name: course.name, date: fmtDate(dateFor), time: fmt12Hour(slot.time),
        teacher: teacherName(teachers, course.teacherId),
      }),
      () => afterMutate(saveSlotException({ slotId: slot.id, date: dateFor, kind: 'cancelled' }), t('timetable:weeklyCalendar.cancelSuccessToast')),
      t('timetable:weeklyCalendar.cancelTitle')
    );
  }

  function undoException(exc, course) {
    const kind = exc.kind === 'cancelled' ? t('timetable:weeklyCalendar.kindCancellation') : t('timetable:weeklyCalendar.kindReschedule');
    confirmAction(
      t('timetable:weeklyCalendar.undoConfirm', { kind, code: course.code, date: fmtDate(exc.date) }),
      () => afterMutate(deleteSlotException(exc.id), t('timetable:weeklyCalendar.undoSuccessToast')),
      t('common:actions.undo')
    );
  }

  /** The persistent, labeled quick-action footer row — role-specific, always visible (unlike the
      old hover-only admin C/R buttons it replaces). Only rendered on a real dated occurrence
      (dateFor set), same requirement as the rest of the per-date quick actions. */
  function quickActionsFor(course, slot, dateFor) {
    if (editable) {
      const issue = conflictIssueBySlotId?.get(slot.id);
      return (
        <div className="slot-quick-actions">
          <QuickAction icon="ti-edit" label={t('timetable:weeklyCalendar.quickActions.editSlot')} onClick={() => openModal('slot', slot.id)} />
          <QuickAction icon="ti-arrows-move" label={t('timetable:weeklyCalendar.quickActions.move')} onClick={() => openModal('move-slot', slot.id, { date: dateFor })} />
          <QuickAction icon="ti-calendar-off" label={t('timetable:weeklyCalendar.quickActions.cancel')} onClick={() => cancelThisDate(slot, course, dateFor)} />
          <QuickAction icon="ti-alert-triangle" label={t('timetable:weeklyCalendar.quickActions.conflicts')} dot={!!issue} dotDanger disabled={!issue} onClick={() => openModal('conflict-detail', null, { issue })} />
        </div>
      );
    }
    if (currentUser.role === 'faculty') {
      return (
        <div className="slot-quick-actions">
          <QuickAction icon="ti-file-plus" label={t('timetable:weeklyCalendar.quickActions.assign')} onClick={() => openModal('course-actions', course.id, { autoOpenAssignment: true })} />
          <QuickAction icon="ti-clipboard-check" label={t('timetable:weeklyCalendar.quickActions.attendance')} onClick={() => showSection('attendance', { courseId: course.id })} />
          <QuickAction icon="ti-report-analytics" label={t('timetable:weeklyCalendar.quickActions.marks')} onClick={() => showSection('gradebook', { courseId: course.id })} />
          <QuickAction icon="ti-users" label={t('timetable:weeklyCalendar.quickActions.roster')} onClick={() => openModal('roster', course.id)} />
        </div>
      );
    }
    if (currentUser.role === 'student') {
      return (
        <div className="slot-quick-actions">
          <QuickAction icon="ti-clipboard-check" label={t('timetable:weeklyCalendar.quickActions.attendance')} onClick={() => showSection('my-attendance', { courseId: course.id })} />
          <QuickAction icon="ti-writing" label={t('timetable:weeklyCalendar.quickActions.assignments')} dot={!!unviewedCourseIds?.has(course.id)} onClick={() => openModal('course-activity', course.id)} />
          <QuickAction icon="ti-folder" label={t('timetable:weeklyCalendar.quickActions.materials')} onClick={() => openModal('course-activity', course.id, { focus: 'materials' })} />
          <QuickAction icon="ti-report-analytics" label={t('timetable:weeklyCalendar.quickActions.grades')} onClick={() => showSection('mygrades', { courseId: course.id })} />
        </div>
      );
    }
    return null;
  }

  return (
    <div className="panel panel-cal">
      <div className="cal-wrap">
        <div className="cal-row cal-header-row">
          {DAYS.map(d => {
            const isToday = weekDates && weekDates[d] === today;
            return (
              <div
                key={d}
                className={'cal-day-header' + (isToday ? ' cal-today' : '')}
                style={{ display: !dayFilter || dayFilter === d ? '' : 'none' }}
              >
                {isToday && <span className="cal-today-badge">{t('timetable:weeklyCalendar.todayBadge')}</span>}
                {t('common:days.' + d)}
                {weekDates && <span className="cal-day-date">{fmtDate(weekDates[d])}</span>}
              </div>
            );
          })}
        </div>
        <div className="cal-row cal-body-row">
          {DAYS.map(d => {
            const dateFor = weekDates ? weekDates[d] : null;

            // Regular occurrences, each annotated with this date's exception (if any)...
            const entries = slotsToShow.filter(s => s.day === d).map(slot => ({
              key: `s${slot.id}`, slot,
              exc: dateFor ? exceptions.find(x => x.slotId === slot.id && x.date === dateFor) : null,
              movedIn: false, time: slot.time,
              duration: slot.durationMinutes || 60, roomId: slot.roomId,
            }));
            // ...plus sessions moved ONTO this date from elsewhere.
            if (dateFor) {
              exceptions.filter(x => x.kind === 'rescheduled' && x.newDate === dateFor && shownSlotIds.has(x.slotId)).forEach(x => {
                const slot = slotsToShow.find(s => s.id === x.slotId);
                entries.push({
                  key: `x${x.id}`, slot, exc: x, movedIn: true, time: x.newTime,
                  duration: x.newDurationMinutes || slot.durationMinutes || 60,
                  roomId: x.newRoomId ?? slot.roomId,
                });
              });
            }
            entries.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

            const isTodayCol = dateFor === today;
            return (
              <div key={d} className={'cal-day-col' + (isTodayCol ? ' cal-col-today' : '')} style={{ display: !dayFilter || dayFilter === d ? '' : 'none' }}>
                {entries.length === 0 && (
                  <div className="cal-day-empty">
                    <i className="ti ti-calendar-off" aria-hidden="true"></i>
                    <div className="cal-day-empty-title">{t('timetable:weeklyCalendar.dayOff')}</div>
                  </div>
                )}
                {entries.map(({ key, slot, exc, movedIn, time, duration, roomId }) => {
                  const course = courseById(courses, slot.courseId);
                  if (!course) return null;
                  const isCancelled = !movedIn && exc?.kind === 'cancelled';
                  const isMovedAway = !movedIn && exc?.kind === 'rescheduled';
                  const isConflict = !movedIn && !exc && conflictSlotIds && conflictSlotIds.has(slot.id);
                  const endTime = addMinutes(time, duration);
                  let cls;
                  if (movedIn) cls = 'slot-moved-in';
                  else if (isMovedAway) cls = 'slot-moved-away';
                  else if (isCancelled) cls = 'slot-suspended';
                  else if (isConflict) cls = 'slot-conflict';
                  else cls = `slot-course-${courseColor(course.id)}`;
                  const hasSemBadge = showSemesterBadge && slot.programSemester != null && !movedIn;
                  // A quick action only makes sense on a real, dated occurrence the admin can
                  // act on "right now" — not in the plain recurring view (no weekDates).
                  const canQuickAct = editable && dateFor;
                  return (
                    <div
                      key={key}
                      className={'slot ' + cls + (hasSemBadge ? ' has-sem-badge' : '')}
                      onClick={editable ? () => openModal('slot', slot.id) : onCardClick ? () => onCardClick(course, slot) : undefined}
                      title={course.name + (exc?.note ? ` — ${exc.note}` : '')}
                    >
                      <div className="slot-name">{course.name}{isConflict ? ' ⚠' : ''}</div>
                      <div className="slot-meta">
                        <div className="slot-meta-row slot-time"><i className="ti ti-clock" aria-hidden="true"></i>{fmt12Hour(time)}–{fmt12Hour(endTime)}</div>
                        <div className="slot-meta-row"><i className="ti ti-map-pin" aria-hidden="true"></i>{roomName(rooms, roomId)}</div>
                        {showLecturer && !isCancelled && !isMovedAway && (
                          <div className="slot-meta-row"><i className="ti ti-user" aria-hidden="true"></i>{teacherName(teachers, course.teacherId)}</div>
                        )}
                      </div>
                      {isCancelled && <span className="slot-badge slot-badge-cancelled">{t('timetable:weeklyCalendar.cancelledBadge')}</span>}
                      {isMovedAway && (
                        <span className="slot-badge slot-badge-moved">
                          {t('timetable:weeklyCalendar.movedAwayBadge', {
                            when: exc.newDate === exc.date ? fmt12Hour(exc.newTime) : `${fmtDate(exc.newDate)} ${fmt12Hour(exc.newTime)}`,
                          })}
                        </span>
                      )}
                      {movedIn && (
                        <span className="slot-badge slot-badge-moved">
                          {exc.date !== exc.newDate
                            ? t('timetable:weeklyCalendar.movedInFromBadge', { date: fmtDate(exc.date) })
                            : t('timetable:weeklyCalendar.movedInBadge')}
                        </span>
                      )}
                      {hasSemBadge && <div className="slot-sem-badge">{t('timetable:weeklyCalendar.semBadge', { n: slot.programSemester })}</div>}
                      {currentUser.role === 'student' && finalGradesByCourseId?.get(course.id)?.letterGrade && (
                        <div className="slot-grade-badge" title={t('timetable:weeklyCalendar.finalGradeTitle')}>
                          {finalGradesByCourseId.get(course.id).letterGrade}
                        </div>
                      )}

                      {!!dateFor && (!editable || !exc) && quickActionsFor(course, slot, dateFor)}
                      {canQuickAct && exc && (
                        <span
                          className="slot-quick"
                          onClick={e => { e.stopPropagation(); undoException(exc, course); }}
                          title={t('timetable:weeklyCalendar.undoTitle')}
                        >
                          <i className="ti ti-arrow-back-up"></i>
                        </span>
                      )}

                      {editable && !movedIn && !exc && (
                        <span
                          className="slot-del"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmAction(t('timetable:weeklyCalendar.removeSlotConfirm'), () => afterMutate(deleteSlot(slot.id), t('timetable:weeklyCalendar.removeSlotToast')));
                          }}
                        >
                          <i className="ti ti-x"></i>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
