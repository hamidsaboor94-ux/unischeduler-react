import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { saveSlot, saveSlotException, deleteSlotException, fetchAvailableRooms, fetchAvailableTimes } from '../../api.js';
import { courseById, roomById, teacherById, fmt12Hour, fmtDate, addMinutes } from '../../utils.js';

/** Standalone "Move" flow for a single session's room/time — the same underlying mechanism as
    ConflictDetailModal's reschedule (suggest only genuinely-free rooms/times via the same
    fetchAvailableRooms/fetchAvailableTimes endpoints, then confirm), but usable from any course
    card's quick-action, not just one that's already in a detected conflict. `prefill.date`, when
    given, targets that single dated occurrence (creating/editing a one-off exception); without
    it, the change applies to the recurring weekly slot itself. */
export default function MoveSlotModal({ editId: slotId, prefill }) {
  const { t } = useTranslation(['timetable', 'common']);
  const { slots, courses, rooms, teachers, slotExceptions, activeTermId, reload } = useAppData();
  const { closeModal } = useModal();
  const { toast } = useToast();
  const date = prefill?.date || null;

  const [mode, setMode] = useState(null); // 'room' | 'time'
  const [options, setOptions] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  const slot = slots.find(s => s.id === slotId);
  if (!slot) return <div id="modal-body"><div className="field-hint">{t('timetable:moveSlotModal.slotGone')}</div></div>;

  const course = courseById(courses, slot.courseId);
  const exception = date ? slotExceptions.find(x => x.slotId === slotId && x.date === date) : null;
  const isCancelled = exception?.kind === 'cancelled';
  const time = exception ? exception.newTime : slot.time;
  const durationMinutes = exception ? (exception.newDurationMinutes || slot.durationMinutes || 60) : (slot.durationMinutes || 60);
  const roomId = exception ? exception.newRoomId : slot.roomId;
  const room = roomId != null ? roomById(rooms, roomId) : null;
  const teacher = course?.teacherId != null ? teacherById(teachers, course.teacherId) : null;

  function reset() { setMode(null); setOptions([]); setSelected(''); }

  async function openMode(newMode) {
    setMode(newMode); setOptions([]); setSelected(''); setOptionsLoading(true);
    const common = {
      termId: activeTermId,
      day: date ? null : slot.day,
      date: date || null,
      durationMinutes,
      excludeSlotId: slot.id,
      excludeExceptionId: exception ? exception.id : null,
    };
    try {
      if (newMode === 'room') {
        const rows = await fetchAvailableRooms({ ...common, time });
        setOptions(rows);
        setSelected(rows[0] ? String(rows[0].id) : '');
      } else {
        const rows = await fetchAvailableTimes({ ...common, roomId: room?.id, teacherId: teacher?.id });
        setOptions(rows);
        setSelected(rows[0] || '');
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setOptionsLoading(false);
    }
  }

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    try {
      if (exception) {
        await deleteSlotException(exception.id);
        await saveSlotException({
          slotId: exception.slotId, date: exception.date, kind: exception.kind, note: exception.note,
          newDate: exception.newDate,
          newTime: mode === 'time' ? selected : exception.newTime,
          newRoomId: mode === 'room' ? Number(selected) : exception.newRoomId,
          newDurationMinutes: exception.newDurationMinutes,
        });
      } else if (date) {
        await saveSlotException({
          slotId: slot.id, date, kind: 'rescheduled', newDate: date,
          newTime: mode === 'time' ? selected : slot.time,
          newRoomId: mode === 'room' ? Number(selected) : slot.roomId,
          newDurationMinutes: slot.durationMinutes,
        });
      } else {
        await saveSlot(mode === 'room' ? { roomId: Number(selected) } : { time: selected }, slot.id);
      }
      toast(t('timetable:moveSlotModal.toastMoved'));
      await reload();
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div id="modal-body">
        <div className="slot-name">{course ? `${course.code} — ${course.name}` : ''}</div>
        <div className="slot-meta">
          <div className="slot-meta-row slot-time">
            <i className="ti ti-clock" aria-hidden="true"></i>
            {fmt12Hour(time)}–{fmt12Hour(addMinutes(time, durationMinutes))}
            {date ? ` · ${fmtDate(date)}` : ` · ${t('common:days.' + slot.day)}`}
          </div>
          <div className="slot-meta-row"><i className="ti ti-map-pin" aria-hidden="true"></i>{room?.name || t('timetable:moveSlotModal.noRoom')}</div>
          {teacher && <div className="slot-meta-row"><i className="ti ti-user" aria-hidden="true"></i>{teacher.name}</div>}
        </div>

        {isCancelled ? (
          <div className="field-hint" style={{ marginTop: 12 }}>{t('timetable:moveSlotModal.cancelledHint')}</div>
        ) : (
          <>
            <div className="conflict-action-row">
              <button className="btn-sm" onClick={() => openMode('room')}><i className="ti ti-door"></i> {t('timetable:moveSlotModal.changeRoom')}</button>
              <button className="btn-sm" onClick={() => openMode('time')}><i className="ti ti-clock-hour-4"></i> {t('timetable:moveSlotModal.changeTime')}</button>
            </div>

            {mode && (
              <div className="conflict-reschedule-form">
                {optionsLoading ? (
                  <div className="field-hint">{t('common:actions.loading')}</div>
                ) : options.length === 0 ? (
                  <div className="field-hint">
                    {mode === 'room' ? t('timetable:moveSlotModal.noRoomsAvailable') : t('timetable:moveSlotModal.noTimesAvailable')}
                  </div>
                ) : (
                  <select value={selected} onChange={e => setSelected(e.target.value)}>
                    {mode === 'room'
                      ? options.map(r => <option key={r.id} value={r.id}>{r.name}</option>)
                      : options.map(tm => <option key={tm} value={tm}>{fmt12Hour(tm)}</option>)}
                  </select>
                )}
                <div className="conflict-action-row">
                  <button className="btn-sm" onClick={reset}>{t('common:actions.cancel')}</button>
                  <button
                    className={'btn-primary' + (busy ? ' btn-loading' : '')}
                    disabled={busy || !selected || options.length === 0}
                    onClick={confirm}
                  >
                    {busy ? <span className="spinner"></span> : t('timetable:moveSlotModal.confirmMove')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
      </div>
    </>
  );
}
