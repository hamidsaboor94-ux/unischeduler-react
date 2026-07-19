import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useModalSave } from '../../hooks/useModalSave.js';
import { useToast } from '../../context/ToastContext.jsx';
import { saveSlot, deleteSlot } from '../../api.js';
import { DAYS, DURATION_OPTIONS, courseById, departmentName } from '../../utils.js';

export default function SlotForm({ editId, prefill }) {
  const { t } = useTranslation(['timetable', 'common', 'shell']);
  const { slots, courses, rooms, departments, activeTermId, afterMutate, slotExceptions } = useAppData();
  const { closeModal, confirmAction, openModal } = useModal();
  const { save, loading } = useModalSave();
  const { toast } = useToast();

  const existing = editId ? slots.find(x => x.id === editId) : null;
  const seed = existing || {
    day: prefill?.day || 'Mon', time: prefill?.time || '08:00', durationMinutes: 60,
    courseId: courses[0]?.id, roomId: rooms[0]?.id,
    programSemester: prefill?.programSemester ?? null, section: prefill?.section ?? '',
  };

  const [day, setDay] = useState(seed.day);
  const [time, setTime] = useState(seed.time);
  const [durationMinutes, setDurationMinutes] = useState(seed.durationMinutes || 60);
  const [courseId, setCourseId] = useState(seed.courseId);
  const [roomId, setRoomId] = useState(seed.roomId);
  const [programSemester, setProgramSemester] = useState(seed.programSemester != null ? String(seed.programSemester) : '');
  const [section, setSection] = useState(seed.section || '');

  const course = courseById(courses, Number(courseId));
  const courseDeptLabel = course ? `${course.code} — ${departmentName(departments, course.departmentId)}` : '';

  // Opened from a specific day column: the day is already implied by what was clicked, and the
  // semester/section are already implied by the page's active filters, so lock those down instead
  // of asking the admin to re-pick context they already established.
  const lockedFromDay = !editId && !!prefill?.fromDayCell;
  const dayLocked = lockedFromDay;
  const semesterLocked = lockedFromDay && prefill?.programSemester != null;
  const sectionLocked = lockedFromDay && !!prefill?.section;

  async function handleSave() {
    const result = await save(() => saveSlot({
      day, time, durationMinutes: Number(durationMinutes),
      courseId: Number(courseId), roomId: Number(roomId), termId: activeTermId,
      programSemester: programSemester ? Number(programSemester) : null,
      section: section.trim() || null,
    }, editId), {
      validate: () => (!time ? t('timetable:slotForm.validateStartTime') : null),
    });
    // Saved successfully, but it overlaps an existing room/instructor booking — the save
    // itself isn't blocked (real timetables sometimes need to accept one temporarily), but
    // the admin should be told exactly what it clashes with right away, not just find out
    // later on the Conflicts page.
    if (result && result.conflictWarnings?.length) {
      toast(result.conflictWarnings.join(' • '), 'warning');
    }
    return result;
  }

  function handleDelete() {
    closeModal();
    confirmAction(t('timetable:slotForm.deleteConfirm'), () => afterMutate(deleteSlot(editId), t('timetable:slotForm.deleteToast')));
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('timetable:slotForm.dayLabel')}</div>
            {dayLocked ? (
              <div className="form-static">{t('common:days.' + day)}</div>
            ) : (
              <select value={day} onChange={e => setDay(e.target.value)}>
                {DAYS.map(d => <option key={d} value={d}>{t('common:days.' + d)}</option>)}
              </select>
            )}
          </div>
          <div className="form-row">
            <div className="form-label">{t('timetable:slotForm.startTimeLabel')}</div>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-label">{t('timetable:slotForm.durationLabel')}</div>
          <select value={durationMinutes} onChange={e => setDurationMinutes(e.target.value)}>
            {DURATION_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.course')}</div>
          <select value={courseId} onChange={e => setCourseId(e.target.value)}>
            {courses.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
          <div className="field-hint">{courseDeptLabel}</div>
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.room')}</div>
          <select value={roomId} onChange={e => setRoomId(e.target.value)}>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('timetable:slotForm.programSemesterLabel')}</div>
            {semesterLocked ? (
              <div className="form-static">{t('timetable:timetablePage.semesterOption', { n: programSemester })}</div>
            ) : (
              <select value={programSemester} onChange={e => setProgramSemester(e.target.value)}>
                <option value="">{t('timetable:slotForm.notSet')}</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </div>
          <div className="form-row">
            <div className="form-label">{t('timetable:slotForm.sectionLabel')}</div>
            {sectionLocked ? (
              <div className="form-static">{t('timetable:timetablePage.sectionOption', { sec: section })}</div>
            ) : (
              <input type="text" placeholder={t('timetable:slotForm.sectionPlaceholder')} value={section} onChange={e => setSection(e.target.value)} />
            )}
          </div>
        </div>
        {editId && (
          <div className="form-row" style={{ marginTop: 4 }}>
            <div className="form-label">{t('shell:modal.oneOffExceptions')}</div>
            <button className="btn-sm" onClick={() => openModal('slot-exceptions', editId)}>
              <i className="ti ti-calendar-off"></i> {t('timetable:slotForm.manageExceptionsButton')}
              {(() => { const n = slotExceptions.filter(x => x.slotId === editId).length; return n ? ` ${t('timetable:slotForm.activeExceptionsCount', { count: n })}` : ''; })()}
            </button>
          </div>
        )}
        <div className="field-hint">{t('timetable:slotForm.overlapHint')}</div>
      </div>
      <div id="modal-footer" className="modal-footer">
        {editId && <button className="modal-danger-btn" onClick={handleDelete}>{t('common:actions.delete')}</button>}
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleSave}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
        </button>
      </div>
    </>
  );
}
