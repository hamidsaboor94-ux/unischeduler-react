import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { saveBranding } from '../api.js';
import BrandingForm from './BrandingForm.jsx';

/** Shown exactly once per database — the first time an admin logs in and no org branding has
    been configured yet (see AppDataContext's boot()). Saving anything here, including "skip",
    sets orgName in the database, which is what stops this screen from ever appearing again. */
export default function BrandingSetupScreen() {
  const { t } = useTranslation(['shell', 'common']);
  const { completeBrandingSetup } = useAppData();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();

  async function handleSkip() {
    try {
      await run(saveBranding({ orgName: 'UniScheduler', brandColor: null }));
      await completeBrandingSetup();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-box" style={{ width: 420 }}>
        <div className="auth-brand">
          <div className="brand-icon" style={{ background: 'var(--accent)' }}><i className="ti ti-school" aria-hidden="true"></i></div>
          <span className="brand-name">{t('shell:brandingSetup.welcome', { appName: t('common:appName') })}</span>
        </div>
        <div className="field-hint" style={{ marginBottom: 18 }}>
          {t('shell:brandingSetup.hint')}
        </div>
        <BrandingForm submitLabel={t('shell:brandingSetup.saveAndContinue')} showSkip={!loading} onSkip={handleSkip} onSaved={completeBrandingSetup} />
      </div>
    </div>
  );
}
