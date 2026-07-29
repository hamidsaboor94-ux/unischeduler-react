import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useModalSave } from '../../hooks/useModalSave.js';
import { saveDepartment, deleteDepartment } from '../../api.js';
import { departmentById } from '../../utils.js';

export default function DepartmentForm({ editId }) {
  const { t } = useTranslation(['management', 'common']);
  const { departments, colleges, afterMutate } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { save, loading } = useModalSave();

  const seed = editId ? departmentById(departments, editId) : { name: '', collegeId: '' };
  const [name, setName] = useState(seed.name);
  const [collegeId, setCollegeId] = useState(seed.collegeId ?? '');

  function handleSave() {
    return save(() => saveDepartment({ name: name.trim(), collegeId: collegeId ? Number(collegeId) : null }, editId), {
      validate: () => (!name.trim() ? t('management:departmentForm.validateName') : null),
    });
  }

  function handleDelete() {
    closeModal();
    confirmAction(t('management:departmentForm.confirmDelete', { name: seed.name }), () => afterMutate(deleteDepartment(editId), t('management:departmentForm.toastRemoved')));
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('management:departmentForm.nameLabel')}</div>
          <input type="text" placeholder={t('management:departmentForm.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.college')}</div>
          <select value={collegeId} onChange={e => setCollegeId(e.target.value)}>
            <option value="">{t('management:departmentForm.noCollege')}</option>
            {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
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
