import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import ConflictItem from '../components/ConflictItem.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAutoResolve } from '../hooks/useSchedulingActions.js';
import { StatCard } from '../components/ui/StatCard.jsx';
import { fmt12Hour, fmtDate } from '../utils.js';

/** One resolution's before/after state as a short human-readable string — the shape of
    `before`/`after` varies by conflictType (day+time+room for slot moves, date+time for exam
    reschedules, room+capacity for capacity fixes, invigilator name for the shortage fix), so
    this just renders whichever fields are actually present. */
function describeState(state, t) {
  if (!state) return '—';
  const parts = [];
  if (state.day) parts.push(t('common:days.' + state.day));
  if (state.date) parts.push(fmtDate(state.date));
  if (state.time) parts.push(fmt12Hour(state.time));
  if (state.roomName) parts.push(state.roomName);
  if (state.capacity != null) parts.push(`cap ${state.capacity}`);
  if ('invigilatorName' in state) parts.push(state.invigilatorName || t('admin:conflictsPage.recentlyResolved.unassigned'));
  return parts.length ? parts.join(' · ') : '—';
}

export default function ConflictsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { conflictsData, lastResolutions, setLastResolutions, reload } = useAppData();
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
          <StatCard
            icon="ti-building" hue="red"
            label={t('admin:conflictsPage.stats.critical.label')}
            value={critical.length}
            sub={t('admin:conflictsPage.stats.critical.sub')}
          />
          <StatCard
            icon="ti-alert-triangle" hue="amber"
            label={t('admin:conflictsPage.stats.warnings.label')}
            value={warnings.length}
            sub={t('admin:conflictsPage.stats.warnings.sub')}
          />
          <StatCard
            icon="ti-info-circle" hue="indigo"
            label={t('admin:conflictsPage.stats.notices.label')}
            value={notices.length}
            sub={t('admin:conflictsPage.stats.notices.sub')}
          />
          <StatCard
            icon="ti-check" hue="teal"
            label={t('admin:conflictsPage.stats.allClear.label')}
            value={total === 0 ? t('common:actions.yes') : t('common:actions.no')}
            sub={t('admin:conflictsPage.stats.allClear.sub')}
          />
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
        {lastResolutions.length > 0 && (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                {t('admin:conflictsPage.recentlyResolved.title')}
                {' · '}{t('admin:conflictsPage.recentlyResolved.subtitle', { count: lastResolutions.length })}
              </div>
              <button className="btn-sm" onClick={() => setLastResolutions([])}>
                {t('admin:conflictsPage.recentlyResolved.dismiss')}
              </button>
            </div>
            <div className="resolution-list">
              {lastResolutions.map((r, i) => (
                <div className="resolution-item" key={i}>
                  <i className="ti ti-circle-check" aria-hidden="true"></i>
                  <div style={{ flex: 1 }}>
                    <div className="resolution-action">{r.action}</div>
                    {r.reason && <div className="resolution-reason">{r.reason}</div>}
                    <div className="resolution-diff">
                      <span className="pill pill-gray">{describeState(r.before, t)}</span>
                      <i className="ti ti-arrow-right" aria-hidden="true"></i>
                      <span className="pill pill-green">{describeState(r.after, t)}</span>
                    </div>
                  </div>
                  <span className="pill pill-blue">{t('admin:conflictsPage.recentlyResolved.types.' + r.conflictType, r.conflictType)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
