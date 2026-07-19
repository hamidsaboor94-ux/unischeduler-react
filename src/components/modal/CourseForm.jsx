import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { api, saveCourse, deleteCourse } from '../../api.js';
import { courseById } from '../../utils.js';

export default function CourseForm({ editId }) {
  const { t } = useTranslation(['management', 'common']);
  const { courses, departments, teachers, rooms, terms, activeTermId, currentUser, reload, afterMutate } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();

  const seed = editId ? courseById(courses, editId) : {
    code: '', name: '', departmentId: departments[0]?.id, credits: 3,
    teacherId: teachers[0]?.id, roomId: rooms[0]?.id, maxStudents: 30, termId: activeTermId,
  };

  const [code, setCode] = useState(seed.code);
  const [name, setName] = useState(seed.name);
  const [departmentId, setDepartmentId] = useState(seed.departmentId);
  const [credits, setCredits] = useState(seed.credits);
  const [teacherId, setTeacherId] = useState(seed.teacherId);
  const [roomId, setRoomId] = useState(seed.roomId);
  const [maxStudents, setMaxStudents] = useState(seed.maxStudents);
  const [termId, setTermId] = useState(seed.termId);

  // Prerequisites: only editable on an existing course (matches the original's
  // "save first, then reopen to set prerequisites" behavior for new courses).
  const [initialPrereqIds, setInitialPrereqIds] = useState(null); // null = still loading
  const [checkedPrereqIds, setCheckedPrereqIds] = useState([]);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await api('GET', `/courses/${editId}/prerequisites`);
        if (cancelled) return;
        const ids = current.map(p => p.id);
        setInitialPrereqIds(ids);
        setCheckedPrereqIds(ids);
      } catch (err) {
        if (!cancelled) { setInitialPrereqIds([]); toast(err.message, 'error'); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  function togglePrereq(id) {
    setCheckedPrereqIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSave() {
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();
    if (!trimmedCode || !trimmedName) { toast(t('management:courseForm.validateRequired'), 'warning'); return; }
    try {
      await run((async () => {
        await saveCourse({
          code: trimmedCode, name: trimmedName, departmentId: Number(departmentId), credits: Number(credits),
          teacherId: Number(teacherId), roomId: Number(roomId), maxStudents: Number(maxStudents) || 1, termId: Number(termId),
        }, editId);
        if (editId && initialPrereqIds) {
          const toAdd = checkedPrereqIds.filter(pid => !initialPrereqIds.includes(pid));
          const toRemove = initialPrereqIds.filter(pid => !checkedPrereqIds.includes(pid));
          await Promise.all([
            ...toAdd.map(pid => api('POST', `/courses/${editId}/prerequisites`, { prerequisiteCourseId: pid })),
            ...toRemove.map(pid => api('DELETE', `/courses/${editId}/prerequisites/${pid}`)),
          ]);
        }
      })());
      closeModal();
      toast(t('management:courseForm.toastSaved'));
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleDelete() {
    closeModal();
    confirmAction(t('management:courseForm.confirmDelete', { code: seed.code }), () => afterMutate(deleteCourse(editId), t('management:courseForm.toastRemoved')));
  }

  const prereqOptions = editId ? courses.filter(other => other.id !== editId) : [];

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('management:courseForm.codeLabel')}</div>
          <input type="text" placeholder={t('management:courseForm.codePlaceholder')} value={code} onChange={e => setCode(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-label">{t('management:courseForm.nameLabel')}</div>
          <input type="text" placeholder={t('management:courseForm.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('management:courseForm.departmentLabel')}</div>
            <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-label">{t('management:courseForm.creditsLabel')}</div>
            <select value={credits} onChange={e => setCredits(e.target.value)}>
              {[2, 3, 4].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-label">{t('management:courseForm.instructorLabel')}</div>
          <select value={teacherId} onChange={e => setTeacherId(e.target.value)}>
            {teachers.map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
          </select>
        </div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('management:courseForm.primaryRoomLabel')}</div>
            <select value={roomId} onChange={e => setRoomId(e.target.value)}>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-label">{t('management:courseForm.maxStudentsLabel')}</div>
            <input type="number" min="1" value={maxStudents ?? ''} onChange={e => setMaxStudents(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-label">{t('management:courseForm.termLabel')}</div>
          <select value={termId} onChange={e => setTermId(e.target.value)}>
            {terms.map(tm => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>
        </div>
        {editId ? (
          <div className="form-row">
            <div className="form-label">{t('management:courseForm.prerequisitesLabel')}</div>
            <div className="checkbox-list">
              {prereqOptions.length
                ? prereqOptions.map(o => (
                  <label className="checkbox-row" key={o.id}>
                    <input type="checkbox" checked={checkedPrereqIds.includes(o.id)} onChange={() => togglePrereq(o.id)} /> {o.code} — {o.name}
                  </label>
                ))
                : <div className="field-hint">{t('management:courseForm.noOtherCourses')}</div>}
            </div>
          </div>
        ) : (
          <div className="field-hint">{t('management:courseForm.saveFirstHint')}</div>
        )}
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
