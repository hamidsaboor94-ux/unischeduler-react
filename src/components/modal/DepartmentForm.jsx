import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useModalSave } from '../../hooks/useModalSave.js';
import { saveDepartment, deleteDepartment } from '../../api.js';
import { departmentById } from '../../utils.js';

export default function DepartmentForm({ editId }) {
  const { t } = useTranslation(['management', 'common']);
  const { departments, afterMutate } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { save, loading } = useModalSave();

  const seed = editId ? departmentById(departments, editId) : { name: '' };
  const [name, setName] = useState(seed.name);

  function handleSave() {
    return save(() => saveDepartment({ name: name.trim() }, editId), {
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
