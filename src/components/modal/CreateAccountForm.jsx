import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { api } from '../../api.js';

export default function CreateAccountForm() {
  const { t } = useTranslation(['admin', 'common', 'shell']);
  const { departments, reload } = useAppData();
  const { openModal, closeModal } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('student');
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');

  async function handleCreate() {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) { toast(t('admin:createAccountForm.toast.nameEmailRequired'), 'warning'); return; }
    const deptId = role === 'faculty' ? Number(departmentId) || undefined : undefined;
    if (role === 'faculty' && !deptId) { toast(t('admin:createAccountForm.toast.pickDepartment'), 'warning'); return; }
    try {
      const result = await run(api('POST', '/users', { name: trimmedName, email: trimmedEmail, role, departmentId: deptId }));
      await reload();
      openModal('account-credentials', null, {
        accounts: [{ name: result.user.name, email: result.user.email, role: result.user.role, idNumber: result.user.idNumber, tempPassword: result.tempPassword }],
        errors: [],
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('common:fields.fullName')}</div>
          <input type="text" placeholder={t('admin:createAccountForm.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.email')}</div>
          <input type="email" placeholder={t('shell:auth.emailPlaceholder')} value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.role')}</div>
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="student">{t('common:roles.student')}</option>
            <option value="faculty">{t('common:roles.faculty')}</option>
          </select>
        </div>
        {role === 'faculty' && (
          <div className="form-row">
            <div className="form-label">{t('common:fields.department')}</div>
            <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        <div className="field-hint">{t('admin:createAccountForm.tempPasswordHint')}</div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleCreate}>
          {loading ? <span className="spinner"></span> : t('admin:createAccountForm.submit')}
        </button>
      </div>
    </>
  );
}
