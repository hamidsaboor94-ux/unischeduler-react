import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useModalSave } from '../../hooks/useModalSave.js';
import { saveExam, deleteExam } from '../../api.js';
import { DURATION_OPTIONS, EXAM_TYPES } from '../../utils.js';

// Maps utils.js's DURATION_OPTIONS values to translation keys under academics:examForm.durations —
// the English labels live there rather than in utils.js so every language can phrase them naturally.
const DURATION_KEYS = { 30: 'min30', 60: 'hour1', 90: 'hour1_5', 120: 'hour2', 150: 'hour2_5', 180: 'hour3' };

export default function ExamForm({ editId }) {
  const { t } = useTranslation(['academics', 'common']);
  const { exams, courses, rooms, teachers, activeTermId, currentUser, afterMutate } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { save, loading } = useModalSave();

  const existing = editId ? exams.find(x => x.id === editId) : null;
  const seed = existing || { courseId: courses[0]?.id, date: '', time: '09:00', durationMinutes: 120, roomId: rooms[0]?.id, invigilatorId: null, type: 'final' };

  const [courseId, setCourseId] = useState(seed.courseId);
  const [date, setDate] = useState(seed.date || '');
  const [time, setTime] = useState(seed.time || '09:00');
  const [durationMinutes, setDurationMinutes] = useState(seed.durationMinutes || 120);
  const [roomId, setRoomId] = useState(seed.roomId);
  const [invigilatorId, setInvigilatorId] = useState(seed.invigilatorId != null ? String(seed.invigilatorId) : '');
  const [type, setType] = useState(seed.type || 'final');

  function handleSave() {
    return save(() => saveExam({
      courseId: Number(courseId),
      date: date || null,
      time: date ? time : null,
      durationMinutes: Number(durationMinutes),
      roomId: date ? Number(roomId) : null,
      invigilatorId: invigilatorId ? Number(invigilatorId) : null,
      termId: activeTermId,
      type,
    }, editId));
  }

  function handleDelete() {
    closeModal();
    confirmAction(t('academics:examForm.deleteConfirm'), () => afterMutate(deleteExam(editId), t('academics:examForm.toastDeleted')));
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('common:fields.course')}</div>
          <select value={courseId} onChange={e => setCourseId(e.target.value)}>
            {courses.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
        </div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('common:fields.date')}</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-label">{t('academics:examForm.startTime')}</div>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-label">{t('academics:examForm.type')}</div>
          <select value={type} onChange={e => setType(e.target.value)}>
            {EXAM_TYPES.map(v => <option key={v} value={v}>{t(`academics:examForm.types.${v}`)}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-label">{t('academics:examForm.duration')}</div>
          <select value={durationMinutes} onChange={e => setDurationMinutes(e.target.value)}>
            {DURATION_OPTIONS.map(o => <option key={o.v} value={o.v}>{t(`academics:examForm.durations.${DURATION_KEYS[o.v]}`)}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.room')}</div>
          <select value={roomId} onChange={e => setRoomId(e.target.value)}>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-label">{t('academics:examForm.invigilator')}</div>
          <select value={invigilatorId} onChange={e => setInvigilatorId(e.target.value)}>
            <option value="">{t('academics:examForm.noneOption')}</option>
            {teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select>
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        {editId && currentUser.role === 'admin' && <button className="modal-danger-btn" onClick={handleDelete}>{t('common:actions.delete')}</button>}
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleSave}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
        </button>
      </div>
    </>
  );
}
