import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { saveSlot, deleteSlot, saveSlotException, deleteSlotException, fetchAvailableRooms, fetchAvailableTimes } from '../../api.js';
import { courseById, roomById, teacherById, fmt12Hour, fmtDate, addMinutes, weekdayOfDate } from '../../utils.js';

const ROOM_TYPES = new Set(['room-double-booking', 'moved-session-room-clash']);
const TIME_ELIGIBLE_TYPES = new Set(['room-double-booking', 'instructor-double-booking', 'moved-session-room-clash', 'moved-session-instructor-clash']);

/** Focused, actionable view for one Conflicts-page issue — opened from ConflictItem instead of
    just dropping the admin on the general Weekly Timetable to compare sessions by eye. Shows
    every clashing session side by side with what specifically clashes, then lets a
    room/instructor clash be fixed in place (reschedule to a genuinely free room, or a genuinely
    free time) or, for a likely duplicate entry, lets one of the copies be removed outright. */
export default function ConflictDetailModal({ prefill }) {
  const { t } = useTranslation(['admin', 'common']);
  const { slots, courses, rooms, teachers, slotExceptions, activeTermId, reload } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { toast } = useToast();
  const issue = prefill?.issue;

  const [busy, setBusy] = useState(false);
  const [reschedule, setReschedule] = useState(null); // { slotId, mode: 'room'|'time' }
  const [options, setOptions] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selected, setSelected] = useState('');

  if (!issue) return <div id="modal-body"><div className="field-hint">{t('admin:conflictsPage.detail.issueGone')}</div></div>;

  /** One card's worth of display data for a slotId in this issue. For a moved-session-* issue
      (issue.date set), looks up the exception that actually landed this occurrence on that
      date — if found, its newDate/newTime/newRoomId are what's really happening, not the
      slot's regular weekly values. */
  function buildSession(slotId) {
    const slot = slots.find(s => s.id === slotId);
    if (!slot) return null;
    const exception = issue.date
      ? slotExceptions.find(x => x.slotId === slotId && x.kind === 'rescheduled' && x.newDate === issue.date)
      : null;
    const course = courseById(courses, slot.courseId);
    const teacher = course?.teacherId != null ? teacherById(teachers, course.teacherId) : null;
    const roomId = exception ? exception.newRoomId : slot.roomId;
    const time = exception ? exception.newTime : slot.time;
    const durationMinutes = exception ? (exception.newDurationMinutes || slot.durationMinutes || 60) : (slot.durationMinutes || 60);
    return {
      slot, exception, course, teacher,
      room: roomId != null ? roomById(rooms, roomId) : null,
      time, durationMinutes,
      day: exception ? weekdayOfDate(exception.newDate) : slot.day,
      date: exception ? exception.newDate : (issue.date || null),
    };
  }

  const sessions = (issue.slotIds || []).map(buildSession).filter(Boolean);
  // A moved-session clash can only be fixed by editing the one-off exception itself — moving
  // the regular recurring slot would "fix" it for every future week, not just this date.
  const canAct = (session) => (issue.date ? !!session.exception : true);
  const showRoomAction = ROOM_TYPES.has(issue.type);
  const showTimeAction = TIME_ELIGIBLE_TYPES.has(issue.type);
  const isDuplicate = issue.type === 'duplicate-slot';

  function clashFacts() {
    const facts = [];
    if (isDuplicate) facts.push({ icon: 'ti-copy', text: t('admin:conflictsPage.detail.clashDuplicate') });
    const withRoom = sessions.filter(s => s.room);
    if (withRoom.length > 1 && new Set(withRoom.map(s => s.room.id)).size === 1) {
      facts.push({ icon: 'ti-map-pin', text: t('admin:conflictsPage.detail.clashSameRoom', { room: withRoom[0].room.name }) });
    }
    const withTeacher = sessions.filter(s => s.teacher);
    if (withTeacher.length > 1 && new Set(withTeacher.map(s => s.teacher.id)).size === 1) {
      facts.push({ icon: 'ti-user', text: t('admin:conflictsPage.detail.clashSameInstructor', { name: withTeacher[0].teacher.name }) });
    }
    facts.push({ icon: 'ti-clock', text: t('admin:conflictsPage.detail.clashOverlappingTime') });
    if (issue.date) facts.push({ icon: 'ti-calendar-event', text: t('admin:conflictsPage.detail.clashMovedSession') });
    return facts;
  }

  function cancelReschedule() { setReschedule(null); setOptions([]); setSelected(''); }

  async function openReschedule(session, mode) {
    setReschedule({ slotId: session.slot.id, mode });
    setOptions([]); setSelected(''); setOptionsLoading(true);
    const common = {
      termId: activeTermId,
      day: session.exception ? null : session.day,
      date: session.exception ? session.exception.newDate : null,
      durationMinutes: session.durationMinutes,
      excludeSlotId: session.slot.id,
      excludeExceptionId: session.exception ? session.exception.id : null,
    };
    try {
      if (mode === 'room') {
        const rows = await fetchAvailableRooms({ ...common, time: session.time });
        setOptions(rows);
        setSelected(rows[0] ? String(rows[0].id) : '');
      } else {
        const rows = await fetchAvailableTimes({ ...common, roomId: session.room?.id, teacherId: session.teacher?.id });
        setOptions(rows);
        setSelected(rows[0] || '');
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setOptionsLoading(false);
    }
  }

  async function confirmReschedule(session) {
    if (!selected) return;
    setBusy(true);
    try {
      if (session.exception) {
        const x = session.exception;
        await deleteSlotException(x.id);
        await saveSlotException({
          slotId: x.slotId, date: x.date, kind: x.kind, note: x.note,
          newDate: x.newDate,
          newTime: reschedule.mode === 'time' ? selected : x.newTime,
          newRoomId: reschedule.mode === 'room' ? Number(selected) : x.newRoomId,
          newDurationMinutes: x.newDurationMinutes,
        });
      } else {
        await saveSlot(reschedule.mode === 'room' ? { roomId: Number(selected) } : { time: selected }, session.slot.id);
      }
      toast(t('admin:conflictsPage.detail.toastResolved'));
      await reload();
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function removeDuplicate(session) {
    confirmAction(
      t('admin:conflictsPage.detail.confirmRemoveDuplicate'),
      async () => {
        try {
          await deleteSlot(session.slot.id);
          toast(t('admin:conflictsPage.detail.toastRemoved'));
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          await reload();
        }
      },
      t('admin:conflictsPage.detail.confirmRemoveButton')
    );
  }

  return (
    <>
      <div id="modal-body">
        <div className="field-hint" style={{ marginBottom: 12 }}>{issue.desc}</div>

        <div className="conflict-clash-list">
          {clashFacts().map((f, i) => (
            <span className="pill pill-gray" key={i}><i className={'ti ' + f.icon} aria-hidden="true"></i>{f.text}</span>
          ))}
        </div>

        <div className="conflict-session-grid">
          {sessions.map(session => (
            <div className={'conflict-session-card' + (session.exception ? ' is-moved' : '')} key={session.slot.id}>
              {issue.date && (
                <div className="conflict-session-tag">
                  {session.exception ? t('admin:conflictsPage.detail.movedSessionTag') : t('admin:conflictsPage.detail.regularClassTag')}
                </div>
              )}
              <div className="slot-name">{session.course?.code || t('admin:conflictsPage.detail.unknownCourse')}</div>
              <div className="slot-meta">
                <div className="slot-meta-row slot-time">
                  <i className="ti ti-clock" aria-hidden="true"></i>
                  {fmt12Hour(session.time)}–{fmt12Hour(addMinutes(session.time, session.durationMinutes))}
                  {session.date ? ` · ${fmtDate(session.date)}` : ` · ${t('common:days.' + session.day)}`}
                </div>
                <div className="slot-meta-row"><i className="ti ti-map-pin" aria-hidden="true"></i>{session.room?.name || t('admin:conflictsPage.detail.noRoom')}</div>
                {session.teacher && <div className="slot-meta-row"><i className="ti ti-user" aria-hidden="true"></i>{session.teacher.name}</div>}
              </div>

              {canAct(session) && (
                <div className="conflict-action-row">
                  {isDuplicate && (
                    <button className="btn-sm" onClick={() => removeDuplicate(session)}>
                      <i className="ti ti-trash"></i> {t('admin:conflictsPage.detail.removeDuplicate')}
                    </button>
                  )}
                  {showRoomAction && (
                    <button className="btn-sm" onClick={() => openReschedule(session, 'room')}>
                      <i className="ti ti-door"></i> {t('admin:conflictsPage.detail.rescheduleRoom')}
                    </button>
                  )}
                  {showTimeAction && (
                    <button className="btn-sm" onClick={() => openReschedule(session, 'time')}>
                      <i className="ti ti-clock-hour-4"></i> {t('admin:conflictsPage.detail.changeTime')}
                    </button>
                  )}
                </div>
              )}

              {reschedule?.slotId === session.slot.id && (
                <div className="conflict-reschedule-form">
                  {optionsLoading ? (
                    <div className="field-hint">{t('common:actions.loading')}</div>
                  ) : options.length === 0 ? (
                    <div className="field-hint">
                      {reschedule.mode === 'room' ? t('admin:conflictsPage.detail.noRoomsAvailable') : t('admin:conflictsPage.detail.noTimesAvailable')}
                    </div>
                  ) : (
                    <select value={selected} onChange={e => setSelected(e.target.value)}>
                      {reschedule.mode === 'room'
                        ? options.map(r => <option key={r.id} value={r.id}>{r.name}</option>)
                        : options.map(time => <option key={time} value={time}>{fmt12Hour(time)}</option>)}
                    </select>
                  )}
                  <div className="conflict-action-row">
                    <button className="btn-sm" onClick={cancelReschedule}>{t('common:actions.cancel')}</button>
                    <button
                      className={'btn-primary' + (busy ? ' btn-loading' : '')}
                      disabled={busy || !selected || options.length === 0}
                      onClick={() => confirmReschedule(session)}
                    >
                      {busy ? <span className="spinner"></span> : t('admin:conflictsPage.detail.confirmMove')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
      </div>
    </>
  );
}
