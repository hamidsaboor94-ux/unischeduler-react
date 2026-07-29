import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { api } from '../../api.js';
import { ASSIGNABLE_ROLES, isDepartmentScoped, isCollegeScoped, can } from '../../permissions.js';
import { roleLabel } from '../../roleNames.js';

// Every role a Super Admin can create here. Admin is excluded (an existing
// account is promoted to Super Admin from the Users list, never created cold).
const CREATABLE_ROLES = ASSIGNABLE_ROLES.filter(r => r !== 'admin');
// Faculty (linked teacher record) and department-scoped roles both need a department.
const roleNeedsDepartment = (role) => role === 'faculty' || isDepartmentScoped(role);
const roleNeedsCollege = (role) => isCollegeScoped(role);

export default function CreateAccountForm() {
  const { t } = useTranslation(['admin', 'common', 'shell']);
  const { departments, colleges, currentUser, reload, branding } = useAppData();
  const { openModal, closeModal } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();

  // Account creation is Super Admin only (the 'users' module has no other role in POLICY) —
  // mirrors the server's requireRole('admin') on POST /users. See RoomForm.jsx for why this
  // check exists client-side too, given every page (and this modal) stays reachable in the DOM.
  const canWrite = can(currentUser.role, 'users', 'write');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('student');
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');
  const [collegeId, setCollegeId] = useState(colleges[0]?.id ?? '');

  async function handleCreate() {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) { toast(t('admin:createAccountForm.toast.nameEmailRequired'), 'warning'); return; }
    const deptId = roleNeedsDepartment(role) ? Number(departmentId) || undefined : undefined;
    if (roleNeedsDepartment(role) && !deptId) { toast(t('admin:createAccountForm.toast.pickDepartment'), 'warning'); return; }
    const clgId = roleNeedsCollege(role) ? Number(collegeId) || undefined : undefined;
    if (roleNeedsCollege(role) && !clgId) { toast(t('admin:createAccountForm.toast.pickCollege'), 'warning'); return; }
    try {
      const result = await run(api('POST', '/users', { name: trimmedName, email: trimmedEmail, role, departmentId: deptId, collegeId: clgId }));
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
          <input type="text" disabled={!canWrite} placeholder={t('admin:createAccountForm.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.email')}</div>
          <input type="email" disabled={!canWrite} placeholder={t('shell:auth.emailPlaceholder')} value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.role')}</div>
          <select value={role} disabled={!canWrite} onChange={e => setRole(e.target.value)}>
            {CREATABLE_ROLES.map(r => (
              <option key={r} value={r}>{roleLabel(r, t, branding)}</option>
            ))}
          </select>
        </div>
        {roleNeedsDepartment(role) && (
          <div className="form-row">
            <div className="form-label">{t('common:fields.department')}</div>
            <select value={departmentId} disabled={!canWrite} onChange={e => setDepartmentId(e.target.value)}>
              <option value="" disabled>{t('admin:usersPage.selectDepartment')}</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        {roleNeedsCollege(role) && (
          <div className="form-row">
            <div className="form-label">{t('common:fields.college')}</div>
            <select value={collegeId} disabled={!canWrite} onChange={e => setCollegeId(e.target.value)}>
              <option value="" disabled>{t('admin:usersPage.selectCollege')}</option>
              {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="field-hint">{t('admin:createAccountForm.tempPasswordHint')}</div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{canWrite ? t('common:actions.cancel') : t('common:actions.close')}</button>
        {canWrite && (
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleCreate}>
          {loading ? <span className="spinner"></span> : t('admin:createAccountForm.submit')}
        </button>
        )}
      </div>
    </>
  );
}
