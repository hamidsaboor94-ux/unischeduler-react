import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { useAppData } from '../context/AppDataContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { setToken, clearToken, isPersistentToken } from '../tokenStorage.js';

export default function SetPasswordScreen() {
  const { t } = useTranslation(['shell', 'common']);
  const { boot } = useAppData();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const { run, loading } = useAsyncAction();

  async function handleSetPassword(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) { setError(t('shell:setPassword.mismatch')); return; }
    try {
      const rememberMe = isPersistentToken();
      const { token, user } = await run(api('PUT', '/auth/set-password', { newPassword, rememberMe }));
      setToken(token, rememberMe);
      await boot(user);
    } catch (err) {
      setError(err.message);
    }
  }

  function setpwCancel() {
    clearToken();
    // Reload is the simplest faithful way to get back to a fresh 'login' authPhase without
    // threading a cross-cutting "cancel" action through AppDataContext for this one link.
    window.location.reload();
  }

  return (
    <div id="setpw-screen" className="auth-screen">
      <div className="auth-box">
        <div className="auth-brand">
          <div className="brand-icon"><i className="ti ti-key" aria-hidden="true"></i></div>
          <span className="brand-name">{t('shell:setPassword.title')}</span>
        </div>
        <div className="field-hint" style={{ marginBottom: 14 }}>
          {t('shell:setPassword.hint')}
        </div>
        <form className="auth-form" onSubmit={handleSetPassword}>
          <div className="form-row">
            <div className="form-label">{t('common:fields.newPassword')}</div>
            <input type="password" required minLength={8} placeholder={t('shell:setPassword.newPasswordPlaceholder')} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-label">{t('shell:setPassword.confirmNewPassword')}</div>
            <input type="password" required minLength={8} placeholder={t('shell:setPassword.confirmPlaceholder')} value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>
          <div className="auth-error">{error}</div>
          <button className={'btn-primary' + (loading ? ' btn-loading' : '')} type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? <span className="spinner"></span> : t('shell:setPassword.submit')}
          </button>
        </form>
        <div className="field-hint" style={{ marginTop: 14, textAlign: 'center' }}>
          <a href="#" onClick={e => { e.preventDefault(); setpwCancel(); }} style={{ color: 'var(--text-muted)' }}>{t('shell:setPassword.logOutInstead')}</a>
        </div>
      </div>
    </div>
  );
}
