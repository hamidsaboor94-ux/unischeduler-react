import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { useAppData } from '../context/AppDataContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { initials } from '../utils.js';
import { setToken } from '../tokenStorage.js';

export default function AuthScreen({ onApply }) {
  const { t } = useTranslation(['shell', 'common']);
  const { boot, showSetPasswordScreen, branding, logoUrl } = useAppData();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const { run, loading } = useAsyncAction();

  const orgName = branding.orgName || t('common:appName');

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    try {
      const { token, user } = await run(api('POST', '/auth/login', { email: email.trim(), password, rememberMe }));
      setToken(token, rememberMe);
      if (user.mustChangePassword) showSetPasswordScreen();
      else await boot(user);
    } catch (err) {
      setError(err.message);
      // Force the shake to restart even on back-to-back failed attempts (a repeated
      // setShake(true) while already true wouldn't re-trigger the CSS animation).
      setShake(false);
      requestAnimationFrame(() => setShake(true));
    }
  }

  return (
    <div id="auth-screen" className="auth-screen">
      <div className={'auth-box' + (shake ? ' shake' : '')} onAnimationEnd={() => setShake(false)}>
        <div className="auth-logo-wrap">
          <div className="auth-logo">
            {logoUrl ? <img src={logoUrl} alt="" />
              : branding.orgName ? initials(branding.orgName)
              : <i className="ti ti-school" aria-hidden="true"></i>}
          </div>
        </div>
        <div className="auth-heading">
          <h1>{t('shell:auth.welcomeBack')}</h1>
          <p>{t('shell:auth.loginToOrg', { org: orgName })}</p>
        </div>

        <form className="auth-form" onSubmit={handleLogin}>
          <div className="form-row">
            <div className="form-label">{t('common:fields.email')}</div>
            <input type="email" required placeholder={t('shell:auth.emailPlaceholder')} value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-label">{t('common:fields.password')}</div>
            <input type="password" required placeholder={t('shell:auth.passwordPlaceholder')} value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div className="auth-options-row">
            <label className="auth-remember-me">
              <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
              {t('shell:auth.rememberMe')}
            </label>
            <button type="button" className="link-button" onClick={() => setShowForgotPassword(true)}>
              {t('shell:auth.forgotPassword')}
            </button>
          </div>
          <div className="auth-error">{error && <><i className="ti ti-alert-circle" aria-hidden="true"></i>{error}</>}</div>
          <button className={'btn-primary' + (loading ? ' btn-loading' : '')} type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? <span className="spinner"></span> : t('shell:auth.signIn')}
          </button>
        </form>
        {showForgotPassword && (
          <div className="auth-forgot-panel" role="status">
            <strong>{t('shell:auth.forgotPasswordTitle')}</strong>
            <p>{t('shell:auth.forgotPasswordNoEmailHint')}</p>
            <button type="button" className="link-button" onClick={() => setShowForgotPassword(false)}>
              {t('shell:auth.forgotPasswordClose')}
            </button>
          </div>
        )}
        <div className="field-hint" style={{ marginTop: 14, textAlign: 'center' }}>
          {t('shell:auth.noSelfRegistration')}
        </div>
        {onApply && (
          <div className="field-hint" style={{ marginTop: 8, textAlign: 'center' }}>
            {t('shell:auth.applyPrompt')} <button type="button" className="link-button" onClick={onApply}>{t('shell:auth.applyLink')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
