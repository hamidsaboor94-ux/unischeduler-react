import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { approveApplication } from '../../api.js';

/** Confirms department + starting semester, then converts the application into a real student
    account (see POST /applications/:id/approve). On success, hands off to the existing
    account-credentials modal (extended with an emailStatus banner) so the single-approval path
    reuses the same, already-built credentials display as bulk account creation. */
export default function ApplicationApproveModal({ prefill }) {
  const { t } = useTranslation(['admissions', 'studentProfile', 'common']);
  const { openModal, closeModal } = useModal();
  const { departments } = useAppData();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const [departmentId, setDepartmentId] = useState(prefill.desiredDepartmentId ? String(prefill.desiredDepartmentId) : '');
  const [programSemester, setProgramSemester] = useState('1');

  async function handleApprove() {
    if (!departmentId) { toast(t('studentProfile:select'), 'warning'); return; }
    try {
      const result = await run(approveApplication(prefill.applicationId, {
        departmentId: Number(departmentId),
        programSemester: Number(programSemester) || 1,
      }));
      prefill.onApproved?.(result);
      openModal('account-credentials', null, {
        accounts: [{ idNumber: result.student.idNumber, name: result.student.name, email: result.student.email, role: 'student', tempPassword: result.tempPassword }],
        errors: [],
        emailStatus: { sent: result.emailSent, reason: result.emailError },
      });
      toast(t('admissions:toasts.approved'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <div id="modal-body">
        <div className="field-hint" style={{ marginBottom: 14 }}>{t('admissions:approveModal.hint')}</div>
        <div className="form-row">
          <div className="form-label">{t('admissions:approveModal.departmentLabel')}</div>
          <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
            <option value="">{t('studentProfile:select')}</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-label">{t('admissions:approveModal.semesterLabel')}</div>
          <input type="number" min="1" value={programSemester} onChange={e => setProgramSemester(e.target.value)} />
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleApprove}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('admissions:approveModal.confirm')}</>}
        </button>
      </div>
    </>
  );
}
