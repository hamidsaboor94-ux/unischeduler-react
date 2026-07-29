import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { rescheduleSlotException } from '../../api.js';
import { courseById, fmtDate } from '../../utils.js';

/** Deliberately the narrowest possible form: date, time, room for ONE already-cancelled session
    (editId = the slot_exceptions row id). Nothing here can touch the course, the slot's regular
    weekly schedule, any other exception, or an exam — the backend route (PUT
    /slot-exceptions/:id/reschedule) enforces that same scope independently, so this component
    can't widen it just by adding fields. */
export default function RescheduleCancelledSessionModal({ editId }) {
  const { t } = useTranslation(['timetable', 'common']);
  const { slots, courses, rooms, slotExceptions, reload } = useAppData();
  const { closeModal } = useModal();
  const { toast } = useToast();

  const exception = slotExceptions.find(x => x.id === editId);
  const slot = exception ? slots.find(s => s.id === exception.slotId) : null;
  const course = slot ? courseById(courses, slot.courseId) : null;

  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState(slot?.time || '08:00');
  const [newRoomId, setNewRoomId] = useState(slot?.roomId ?? rooms[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  if (!exception || exception.kind !== 'cancelled' || !slot || !course) {
    return <div id="modal-body"><div className="field-hint">{t('timetable:rescheduleCancelledSession.gone')}</div></div>;
  }

  async function handleSave() {
    if (!newDate) { toast(t('timetable:rescheduleCancelledSession.toastPickDate'), 'warning'); return; }
    setSaving(true);
    try {
      await rescheduleSlotException(exception.id, {
        newDate, newTime, newRoomId: newRoomId === '' ? null : Number(newRoomId),
      });
      toast(t('timetable:rescheduleCancelledSession.toastSuccess'));
      await reload();
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div id="modal-body">
        <div className="field-hint" style={{ marginBottom: 10 }}>
          {t('timetable:rescheduleCancelledSession.intro', { code: course.code, date: fmtDate(exception.date) })}
        </div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('timetable:slotExceptions.newDateLabel')}</div>
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-label">{t('timetable:slotExceptions.newStartTimeLabel')}</div>
            <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.room')}</div>
          <select value={newRoomId} onChange={e => setNewRoomId(e.target.value)}>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
        <button className={'btn-primary' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handleSave}>
          {saving ? <span className="spinner"></span> : <><i className="ti ti-calendar-check"></i> {t('timetable:rescheduleCancelledSession.saveButton')}</>}
        </button>
      </div>
    </>
  );
}
