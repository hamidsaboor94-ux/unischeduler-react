import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useModalSave } from '../../hooks/useModalSave.js';
import { saveTeacher, deleteTeacher } from '../../api.js';
import { teacherById } from '../../utils.js';

// Quick-edit for an EXISTING teacher's name/department only — creation now happens through the
// full Faculty Onboarding wizard (see FacultyOnboardingPage.jsx / TeachersPage's Add Teacher
// button), so this modal is always opened with an editId. It still owns renames because Full
// Profile deliberately shows the name as read-only.
export default function TeacherForm({ editId }) {
  const { t } = useTranslation(['management', 'common']);
  const { teachers, departments, allUsers, afterMutate } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { save, loading } = useModalSave();

  const seed = teacherById(teachers, editId);
  const [name, setName] = useState(seed.name);
  // '' means "no department" — a teacher's department is optional (e.g. every teacher
  // auto-created by the PDF timetable importer has none). Kept as a string throughout so
  // it matches the <select>'s value; only converted to a number (or null) at save time.
  const [departmentId, setDepartmentId] = useState(seed.departmentId != null ? String(seed.departmentId) : '');
  // Faculty ID belongs to the linked login account, not the teacher record itself — a
  // teacher added without ever getting a login has no ID yet, hence the possible '—'.
  const facultyId = seed.userId != null ? allUsers.find(u => u.id === seed.userId)?.idNumber : null;

  async function handleSave() {
    await save(() => saveTeacher({
      name: name.trim(),
      // Number(null) is 0, not null — an invalid department id that the backend would
      // reject as a foreign-key violation. Send a real null instead when none is chosen.
      departmentId: departmentId ? Number(departmentId) : null,
    }, editId), {
      validate: () => (!name.trim() ? t('management:teacherForm.validateName') : null),
    });
  }

  function handleDelete() {
    closeModal();
    confirmAction(t('management:teacherForm.confirmDelete', { name: seed.name }), () => afterMutate(deleteTeacher(editId), t('management:teacherForm.toastRemoved')));
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('management:teacherForm.facultyIdLabel')}</div>
          <div className="field-hint"><code>{facultyId || t('management:teacherForm.facultyIdUnassigned')}</code></div>
        </div>
        <div className="form-row">
          <div className="form-label">{t('management:teacherForm.fullNameLabel')}</div>
          <input type="text" placeholder={t('management:teacherForm.fullNamePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.department')}</div>
          <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
            <option value="">{t('management:teacherForm.noDepartment')}</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="modal-danger-btn" onClick={handleDelete}>{t('common:actions.delete')}</button>
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleSave}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
        </button>
      </div>
    </>
  );
}
