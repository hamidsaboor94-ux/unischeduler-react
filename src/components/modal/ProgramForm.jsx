import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useModalSave } from '../../hooks/useModalSave.js';
import { saveProgram, deleteProgram } from '../../api.js';
import { can } from '../../permissions.js';

const DEGREE_LEVELS = ['Certificate', 'Diploma', 'Associate', 'Bachelor', 'Master', 'Doctorate'];

export default function ProgramForm({ editId }) {
  const { t } = useTranslation(['management', 'common']);
  const { programs, departments, currentUser, afterMutate } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { save, loading } = useModalSave();

  // Programs live under the same access policy as departments/colleges (org structure), edited
  // by admins from the Departments page.
  const canWrite = can(currentUser.role, 'departments', 'write');

  const existing = editId ? programs.find(p => p.id === editId) : null;
  const seed = existing || { name: '', departmentId: '', degreeLevel: DEGREE_LEVELS[3], totalCredits: '' };
  const [name, setName] = useState(seed.name);
  const [departmentId, setDepartmentId] = useState(seed.departmentId ?? '');
  const [degreeLevel, setDegreeLevel] = useState(seed.degreeLevel || DEGREE_LEVELS[3]);
  const [totalCredits, setTotalCredits] = useState(seed.totalCredits != null ? String(seed.totalCredits) : '');

  function handleSave() {
    return save(() => saveProgram({
      name: name.trim(),
      departmentId: departmentId ? Number(departmentId) : null,
      degreeLevel,
      totalCredits: totalCredits ? Number(totalCredits) : null,
    }, editId), {
      validate: () => (!name.trim() ? t('management:programForm.validateName') : null),
    });
  }

  function handleDelete() {
    closeModal();
    confirmAction(t('management:programForm.confirmDelete', { name: seed.name }), () => afterMutate(deleteProgram(editId), t('management:programForm.toastRemoved')));
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('management:programForm.nameLabel')}</div>
          <input type="text" disabled={!canWrite} placeholder={t('management:programForm.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.department')}</div>
          <select value={departmentId} disabled={!canWrite} onChange={e => setDepartmentId(e.target.value)}>
            <option value="">{t('management:programForm.noDepartment')}</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('management:programForm.degreeLevel')}</div>
            <select value={degreeLevel} disabled={!canWrite} onChange={e => setDegreeLevel(e.target.value)}>
              {DEGREE_LEVELS.map(l => <option key={l} value={l}>{t(`management:programForm.degreeLevels.${l}`)}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-label">{t('management:programForm.totalCredits')}</div>
            <input type="number" min="0" disabled={!canWrite} value={totalCredits} onChange={e => setTotalCredits(e.target.value)} />
          </div>
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        {editId && canWrite && <button className="modal-danger-btn" onClick={handleDelete}>{t('common:actions.delete')}</button>}
        <button className="btn-sm" onClick={closeModal}>{canWrite ? t('common:actions.cancel') : t('common:actions.close')}</button>
        {canWrite && (
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleSave}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
        </button>
        )}
      </div>
    </>
  );
}
