import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import GradingScaleForm from '../components/GradingScaleForm.jsx';
import GraduationRequirementForm from '../components/GraduationRequirementForm.jsx';

/** Admin-only — defines the single system-wide percent -> letter-grade scale used everywhere
    a final grade is shown (Gradebook, My Grades, course cards, the roster), plus the graduation
    credit target used on the Student Profile page. Both are system-wide academic settings, so
    they share this one page rather than each getting their own nav item. */
export default function GradingScalePage() {
  const { t } = useTranslation(['gradebook', 'common']);
  return (
    <Section name="grading-scale">
      <div className="topbar">
        <i className="ti ti-adjustments" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('gradingScalePage.title')}</h2>
      </div>
      <div id="content">
        <div className="panel" style={{ maxWidth: 480, marginBottom: 14 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('gradingScalePage.panelTitle')}</div>
              <div className="panel-subtitle">{t('gradingScalePage.panelSubtitle')}</div>
            </div>
          </div>
          <GradingScaleForm />
        </div>
        <div className="panel" style={{ maxWidth: 480 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('gradingScalePage.graduationPanelTitle')}</div>
              <div className="panel-subtitle">{t('gradingScalePage.graduationPanelSubtitle')}</div>
            </div>
          </div>
          <GraduationRequirementForm />
        </div>
      </div>
    </Section>
  );
}
