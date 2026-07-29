import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { saveSlotException, deleteSlotException } from '../../api.js';
import { DURATION_OPTIONS, courseById, roomName, fmtDate, fmt12Hour, upcomingSessionDates } from '../../utils.js';

/** Manage one-off exceptions for a single timetable slot (editId = slotId):
    cancel a specific date, or move that date's session to a new date/time/room,
    without touching the slot's normal weekly recurrence. */
export default function SlotExceptionsModal({ editId, prefill }) {
  const { t } = useTranslation(['timetable', 'common']);
  const { slots, courses, rooms, terms, slotExceptions, afterMutate, reload } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { toast } = useToast();

  const slot = slots.find(s => s.id === editId);
  const course = slot ? courseById(courses, slot.courseId) : null;
  const term = slot ? terms.find(tm => tm.id === slot.termId) : null;
  const existing = slotExceptions
    .filter(x => x.slotId === editId)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const existingDates = existing.map(x => x.date).join(',');

  // The class's own weekday/term define which dates it actually meets on, so the "session date
  // to change" field offers only those upcoming occurrences instead of a free-typed date —
  // already-excepted dates are dropped since re-picking one would just 409 (unique per slot+date).
  const sessionDates = useMemo(() => {
    if (!slot) return [];
    const taken = new Set(existingDates ? existingDates.split(',') : []);
    return upcomingSessionDates(slot.day, { termStartDate: term?.startDate, termEndDate: term?.endDate, count: 12 })
      .filter(d => !taken.has(d));
  }, [slot?.day, term?.startDate, term?.endDate, existingDates]);

  // Opened from a specific calendar card (e.g. the "Reschedule…" quick action) arrives with
  // that card's own date already filled in, so the admin doesn't have to re-pick it.
  const [date, setDate] = useState(prefill?.date || sessionDates[0] || '');
  const [kind, setKind] = useState(prefill?.kind || 'cancelled');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState(slot?.time || '08:00');
  const [newRoomId, setNewRoomId] = useState(slot?.roomId ?? rooms[0]?.id);
  const [newDurationMinutes, setNewDurationMinutes] = useState(slot?.durationMinutes || 60);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Keeps the selection valid as sessionDates shifts (e.g. after an exception is added and its
  // date drops out of the list) — advances to the next available occurrence automatically.
  useEffect(() => {
    if (sessionDates.length && !sessionDates.includes(date)) setDate(sessionDates[0]);
  }, [sessionDates]);

  if (!slot || !course) return <div id="modal-body"><div className="field-hint">{t('timetable:slotExceptions.slotGone')}</div></div>;

  async function handleAdd() {
    if (!date) { toast(t('timetable:slotExceptions.toastPickDate'), 'warning'); return; }
    setSaving(true);
    try {
      await saveSlotException({
        slotId: editId, date, kind, note: note.trim() || null,
        ...(kind === 'rescheduled' ? {
          newDate: newDate || date,
          newTime,
          newRoomId: Number(newRoomId),
          newDurationMinutes: Number(newDurationMinutes),
        } : {})
      });
      toast(kind === 'cancelled' ? t('timetable:slotExceptions.toastCancelledSuccess') : t('timetable:slotExceptions.toastMovedSuccess'));
      setNewDate(''); setNote('');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Returns just the "when" part of a rescheduled exception (date/time/room) — used after an
  // arrow (→) next to the original date, so no "Moved to" prefix belongs in this string.
  function exceptionWhenText(x) {
    const sameDay = x.newDate === x.date;
    return `${sameDay ? '' : fmtDate(x.newDate) + ', '}${fmt12Hour(x.newTime)} · ${roomName(rooms, x.newRoomId)}`;
  }

  // Full weekday + year in each option, since fmtDate's short form omits both and this list is
  // the one place a user picks a specific occurrence rather than just reading a known date back.
  function fmtSessionOption(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <>
      <div id="modal-body">
        <div className="field-hint" style={{ marginBottom: 10 }}>
          {t('timetable:slotExceptions.intro', { code: course.code, day: t('common:days.' + slot.day), time: fmt12Hour(slot.time) })}
        </div>

        {existing.length > 0 && (
          <div className="form-row">
            <div className="form-label">{t('timetable:slotExceptions.existingLabel')}</div>
            <div className="exception-list">
              {existing.map(x => (
                <div key={x.id} className="exception-item">
                  <span className={'pill ' + (x.kind === 'cancelled' ? 'pill-red' : 'pill-blue')}>
                    {x.kind === 'cancelled' ? t('timetable:slotExceptions.cancelledPill') : t('timetable:slotExceptions.movedPill')}
                  </span>
                  <span className="exception-text">
                    {fmtDate(x.date)}{x.kind === 'rescheduled' ? ` → ${exceptionWhenText(x)}` : ''}
                    {x.note ? <span className="field-hint"> — {x.note}</span> : null}
                  </span>
                  <button
                    className="icon-btn danger" aria-label={t('timetable:slotExceptions.removeExceptionAriaLabel')}
                    onClick={() => confirmAction(
                      t('timetable:slotExceptions.removeExceptionConfirm', {
                        kind: x.kind === 'cancelled' ? t('timetable:slotExceptions.kindCancellation') : t('timetable:slotExceptions.kindReschedule'),
                        date: fmtDate(x.date),
                      }),
                      () => afterMutate(deleteSlotException(x.id), t('timetable:slotExceptions.removeExceptionToast')),
                      t('timetable:slotExceptions.removeExceptionConfirmButton')
                    )}
                  >
                    <i className="ti ti-x" aria-hidden="true"></i>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('timetable:slotExceptions.sessionDateLabel')}</div>
            {sessionDates.length > 0 ? (
              <select value={date} onChange={e => setDate(e.target.value)}>
                {sessionDates.map(d => <option key={d} value={d}>{fmtSessionOption(d)}</option>)}
              </select>
            ) : (
              <div className="field-hint">{t('timetable:slotExceptions.noUpcomingSessions')}</div>
            )}
          </div>
          <div className="form-row">
            <div className="form-label">{t('timetable:slotExceptions.whatHappensLabel')}</div>
            <select value={kind} onChange={e => setKind(e.target.value)}>
              <option value="cancelled">{t('timetable:slotExceptions.cancelledOption')}</option>
              <option value="rescheduled">{t('timetable:slotExceptions.rescheduledOption')}</option>
            </select>
          </div>
        </div>

        {kind === 'rescheduled' && (
          <>
            <div className="form-row-2">
              <div className="form-row">
                <div className="form-label">{t('timetable:slotExceptions.newDateLabel')}</div>
                <input type="date" value={newDate || date} onChange={e => setNewDate(e.target.value)} />
              </div>
              <div className="form-row">
                <div className="form-label">{t('timetable:slotExceptions.newStartTimeLabel')}</div>
                <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} />
              </div>
            </div>
            <div className="form-row-2">
              <div className="form-row">
                <div className="form-label">{t('common:fields.room')}</div>
                <select value={newRoomId} onChange={e => setNewRoomId(e.target.value)}>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-label">{t('timetable:slotExceptions.durationLabel')}</div>
                <select value={newDurationMinutes} onChange={e => setNewDurationMinutes(e.target.value)}>
                  {DURATION_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </>
        )}

        <div className="form-row">
          <div className="form-label">{t('timetable:slotExceptions.noteLabel')}</div>
          <input type="text" placeholder={t('timetable:slotExceptions.notePlaceholder')} value={note} onChange={e => setNote(e.target.value)} />
        </div>
        {kind === 'rescheduled' && (
          <div className="field-hint">{t('timetable:slotExceptions.clashHint')}</div>
        )}
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
        <button className={'btn-primary' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handleAdd}>
          {saving ? <span className="spinner"></span> : <><i className="ti ti-calendar-off"></i> {t('timetable:slotExceptions.addExceptionButton')}</>}
        </button>
      </div>
    </>
  );
}
