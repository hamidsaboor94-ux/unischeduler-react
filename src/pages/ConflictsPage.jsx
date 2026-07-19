import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import ConflictItem from '../components/ConflictItem.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAutoResolve } from '../hooks/useSchedulingActions.js';

export default function ConflictsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { conflictsData, reload } = useAppData();
  const { toast } = useToast();
  const { autoResolveAll, loading: resolving } = useAutoResolve();
  const { critical, warnings, notices } = conflictsData;

  async function rescan() {
    await reload();
    toast(t('admin:conflictsPage.toast.scanComplete'));
  }

  const total = critical.length + warnings.length + notices.length;

  return (
    <Section name="conflicts">
      <div className="topbar">
        <i className="ti ti-alert-triangle" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('admin:conflictsPage.title')}</h2>
        <div className="topbar-actions">
          <button className="btn-sm" onClick={rescan}><i className="ti ti-refresh"></i> {t('admin:conflictsPage.rescan')}</button>
          <button className={'btn-gold' + (resolving ? ' btn-loading' : '')} disabled={resolving} onClick={autoResolveAll}>
            {resolving ? <span className="spinner"></span> : <><i className="ti ti-wand"></i> {t('admin:conflictsPage.autoResolve')}</>}
          </button>
        </div>
      </div>
      <div id="content">
        <div className="stat-grid">
          <div className="stat-card stat-accent-red">
            <div className="s-icon s-red"><i className="ti ti-building"></i></div>
            <div className="stat-label">{t('admin:conflictsPage.stats.critical.label')}</div>
            <div className="stat-value">{critical.length}</div>
            <div className="stat-sub bad">{t('admin:conflictsPage.stats.critical.sub')}</div>
          </div>
          <div className="stat-card stat-accent-gold">
            <div className="s-icon s-gold"><i className="ti ti-alert-triangle"></i></div>
            <div className="stat-label">{t('admin:conflictsPage.stats.warnings.label')}</div>
            <div className="stat-value">{warnings.length}</div>
            <div className="stat-sub warn">{t('admin:conflictsPage.stats.warnings.sub')}</div>
          </div>
          <div className="stat-card stat-accent-blue">
            <div className="s-icon s-blue"><i className="ti ti-info-circle"></i></div>
            <div className="stat-label">{t('admin:conflictsPage.stats.notices.label')}</div>
            <div className="stat-value">{notices.length}</div>
            <div className="stat-sub">{t('admin:conflictsPage.stats.notices.sub')}</div>
          </div>
          <div className="stat-card stat-accent-green">
            <div className="s-icon s-green"><i className="ti ti-check"></i></div>
            <div className="stat-label">{t('admin:conflictsPage.stats.allClear.label')}</div>
            <div className="stat-value">{total === 0 ? t('common:actions.yes') : t('common:actions.no')}</div>
            <div className="stat-sub ok">{t('admin:conflictsPage.stats.allClear.sub')}</div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><div className="panel-title">{t('admin:conflictsPage.allActiveIssues')}</div></div>
          <div className="alert-list">
            {total === 0 && <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12 }}>{t('admin:conflictsPage.noActiveIssues')}</div>}
            {critical.map((c, i) => <ConflictItem key={'c' + i} issue={c} severity="critical" />)}
            {warnings.map((w, i) => <ConflictItem key={'w' + i} issue={w} severity="warning" />)}
            {notices.map((n, i) => <ConflictItem key={'n' + i} issue={n} severity="notice" />)}
          </div>
        </div>
      </div>
    </Section>
  );
}
