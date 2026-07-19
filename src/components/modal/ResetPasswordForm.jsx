import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useModalSave } from '../../hooks/useModalSave.js';
import { api } from '../../api.js';

export default function ResetPasswordForm({ editId }) {
  const { t } = useTranslation(['admin', 'common', 'shell']);
  const { closeModal } = useModal();
  const { save, loading } = useModalSave();
  const [password, setPassword] = useState('');

  function handleSave() {
    return save(() => api('PUT', `/users/${editId}/password`, { password }), {
      validate: () => (password.length < 8 ? t('admin:resetPasswordForm.validation.minLength') : null),
    });
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('common:fields.newPassword')}</div>
          <input type="password" placeholder={t('shell:setPassword.newPasswordPlaceholder')} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="field-hint">{t('admin:resetPasswordForm.hint')}</div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleSave}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
        </button>
      </div>
    </>
  );
}
