import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import BrandingForm from '../components/BrandingForm.jsx';

/** Admin-only — lets branding be changed anytime after the one-time first-run setup
    (BrandingSetupScreen). Same form, just embedded in a normal page instead of a full-screen
    onboarding card. */
export default function BrandingSettingsPage() {
  const { t } = useTranslation(['dashboard', 'common']);
  return (
    <Section name="branding">
      <div className="topbar">
        <i className="ti ti-palette" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('brandingSettings.title')}</h2>
      </div>
      <div id="content">
        <div className="panel" style={{ maxWidth: 480 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('brandingSettings.panelTitle')}</div>
              <div className="panel-subtitle">{t('brandingSettings.panelSubtitle')}</div>
            </div>
          </div>
          <BrandingForm submitLabel={t('brandingSettings.saveChanges')} />
        </div>
      </div>
    </Section>
  );
}
