import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '../context/NavigationContext.jsx';
import { api, fetchStudents } from '../api.js';
import { StatCard } from './ui/StatCard.jsx';
import { fmtDate } from '../utils.js';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_RESULTS_LIMIT = 6;

/** Real-data-only registration-status pill: green "open" (with a close date if the term has one)
    when the active term's window covers today, gray "closed" otherwise — including when there's
    no active term at all, or when isActive is set but no window has been configured. Never
    invents a state or date that doesn't come from the term row. */
function registrationStatus(term, t) {
  if (!term || !term.isActive) return { tone: 'gray', label: t('dashboard.registrar.registration.closed') };
  const today = new Date().toISOString().slice(0, 10);
  if (term.registrationOpensAt && today < term.registrationOpensAt) {
    return { tone: 'gray', label: t('dashboard.registrar.registration.opensOn', { date: fmtDate(term.registrationOpensAt) }) };
  }
  if (term.registrationClosesAt && today > term.registrationClosesAt) {
    return { tone: 'gray', label: t('dashboard.registrar.registration.closed') };
  }
  if (term.registrationClosesAt) {
    return { tone: 'green', label: t('dashboard.registrar.registration.openUntil', { date: fmtDate(term.registrationClosesAt) }) };
  }
  return { tone: 'green', label: t('dashboard.registrar.registration.open') };
}

/** Registrar's landing dashboard — student records + the registration lifecycle, replacing the
    generic scheduling stat cards every other staff role still sees (see DashboardPage.jsx). Every
    number comes from GET /registrar-dashboard (registrarDashboard.js), a registrar/admin-only
    aggregate endpoint over data (applications, finance) the registrar role has no general module
    access to — see that route's header comment for why it's a dedicated endpoint rather than a
    permissions.js grant. Two features it surfaces don't exist yet (an add/drop request queue, a
    dedicated registration-blocking hold distinct from the exam-only financial hold) — those
    render as real, labeled zeros rather than invented numbers. */
export default function RegistrarDashboard() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { showSection } = useNavigation();

  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('GET', '/registrar-dashboard')
      .then(res => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, []);

  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    const q = searchText.trim();
    if (!q) { setSearchResults([]); setSearching(false); return undefined; }
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchStudents({ search: q, page: 1, pageSize: SEARCH_RESULTS_LIMIT })
        .then(res => setSearchResults((res.items || []).filter(item => item.id != null)))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [searchText]);

  const term = data?.term || null;
  const kpis = data?.kpis || null;
  const queue = data?.queue || null;
  const status = useMemo(() => registrationStatus(term, t), [term, t]);

  const registeredPct = kpis && kpis.totalActiveStudents > 0
    ? Math.min(100, Math.round((kpis.registeredThisTerm / kpis.totalActiveStudents) * 100))
    : 0;
  const dash = kpis == null ? '—' : null;

  const workQueueRows = queue ? [
    {
      key: 'notRegistered', count: queue.notRegisteredThisTerm,
      label: t('dashboard.registrar.queue.notRegistered'),
      onClick: term ? () => showSection('students', { notRegisteredTermId: term.id }) : undefined,
    },
    {
      key: 'newAdmits', count: queue.newAdmitsAwaitingEnrollment,
      label: t('dashboard.registrar.queue.newAdmits'),
      onClick: () => showSection('enrollment'),
    },
    {
      key: 'noApplication', count: queue.noApplicationRecord,
      label: t('dashboard.registrar.queue.noApplication'),
      onClick: () => showSection('students', { flaggedOnly: true }),
    },
    {
      key: 'overCapacity', count: queue.sectionsOverCapacity,
      label: t('dashboard.registrar.queue.overCapacity'),
      onClick: () => showSection('enrollment'),
    },
    {
      key: 'addDrop', count: queue.addDropRequests,
      label: t('dashboard.registrar.queue.addDrop'),
      onClick: undefined,
      note: t('dashboard.registrar.queue.addDropNotBuilt'),
    },
  ] : [];

  const quickActions = [
    { key: 'enroll', icon: 'ti-user-plus', label: t('dashboard.registrar.quickActions.enrollStudent'), onClick: () => showSection('enrollment') },
    { key: 'roster', icon: 'ti-clipboard-list', label: t('dashboard.registrar.quickActions.openRoster'), onClick: () => showSection('enrollment') },
    { key: 'report', icon: 'ti-report-analytics', label: t('dashboard.registrar.quickActions.enrollmentReport'), onClick: () => showSection('reports') },
    { key: 'transcripts', icon: 'ti-file-certificate', label: t('dashboard.registrar.quickActions.transcripts'), onClick: () => showSection('students') },
  ];

  return (
    <div className="registrar-dash">
      <div className="dash-welcome-row">
        <div>
          <div className="dash-welcome-title">{t('dashboard.registrar.header.title')}</div>
          <div className="panel-subtitle">{t('dashboard.registrar.header.subtitle')}</div>
        </div>
        <span className={'pill dash-registration-pill ' + (status.tone === 'green' ? 'pill-green' : 'pill-gray')}>
          <i className={'ti ' + (status.tone === 'green' ? 'ti-lock-open' : 'ti-lock')} aria-hidden="true"></i>
          {status.label}
        </span>
      </div>

      {loadError && (
        <div className="dash-notice" style={{ marginBottom: 14 }}>
          <i className="ti ti-alert-triangle" aria-hidden="true"></i>
          <div className="dash-notice-msg">{t('dashboard.registrar.loadError')}</div>
        </div>
      )}

      <div className="stat-grid">
        <StatCard
          icon="ti-users" hue="teal"
          label={t('dashboard.registrar.kpi.activeStudents')}
          value={dash || kpis.activeStudents}
          sub={kpis && t('dashboard.registrar.kpi.newAdmitsPending', { count: kpis.newAdmitsPending })}
        />
        <StatCard
          icon="ti-clipboard-check" hue="indigo"
          label={t('dashboard.registrar.kpi.registeredThisTerm')}
          value={dash || `${kpis.registeredThisTerm} / ${kpis.totalActiveStudents}`}
        >
          {kpis && (
            <div className="profile-progress-bar" style={{ marginTop: 8 }}>
              <div className="profile-progress-fill" style={{ width: `${registeredPct}%` }}></div>
            </div>
          )}
        </StatCard>
        <StatCard
          icon="ti-lock-exclamation" hue={kpis && kpis.financialHolds > 0 ? 'red' : 'teal'}
          label={t('dashboard.registrar.kpi.registrationHolds')}
          value={dash || kpis.financialHolds}
          sub={t('dashboard.registrar.kpi.registrationHoldsSub')}
        />
        <StatCard
          icon="ti-list-details" hue="indigo"
          label={t('dashboard.registrar.kpi.pendingRequests')}
          value={dash || kpis.pendingRequests}
          sub={t('dashboard.registrar.kpi.pendingRequestsSub')}
        />
      </div>

      <div className="panel-row dash-two-col">
        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.registrar.workQueue.title')}</div>
                <div className="panel-subtitle">{t('dashboard.registrar.workQueue.subtitle')}</div>
              </div>
            </div>
            <div className="alert-list">
              {!queue && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
              {workQueueRows.map(row => (
                <div
                  className={'alert-item alert-neutral' + (row.onClick ? '' : ' dash-queue-row--static')}
                  key={row.key}
                  role={row.onClick ? 'button' : undefined}
                  tabIndex={row.onClick ? 0 : undefined}
                  onClick={row.onClick}
                  onKeyDown={row.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.onClick(); } } : undefined}
                >
                  <span className="dash-queue-count">{row.count}</span>
                  <div style={{ flex: 1 }}>
                    <div className="alert-title">{row.label}</div>
                    {row.note && <div className="alert-desc">{row.note}</div>}
                  </div>
                  {row.onClick && <i className="ti ti-chevron-right" aria-hidden="true"></i>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">{t('dashboard.registrar.findStudent.title')}</div>
            </div>
            <input
              type="text" className="select-sm dash-student-search"
              placeholder={t('dashboard.registrar.findStudent.placeholder')}
              aria-label={t('dashboard.registrar.findStudent.placeholder')}
              value={searchText} onChange={e => setSearchText(e.target.value)}
            />
            <div className="alert-list" style={{ marginTop: searchText.trim() ? 10 : 0 }}>
              {searching && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
              {!searching && searchText.trim() && searchResults.length === 0 && (
                <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.registrar.findStudent.empty')}</div>
              )}
              {!searching && searchResults.map(s => (
                <div
                  className="alert-item alert-neutral" key={s.id} role="button" tabIndex={0}
                  onClick={() => showSection('student-detail', { studentId: s.id })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showSection('student-detail', { studentId: s.id }); } }}
                >
                  <div style={{ flex: 1 }}>
                    <div className="alert-title">{s.name}</div>
                    <div className="alert-desc">{s.idNumber || s.email}</div>
                  </div>
                  <i className="ti ti-chevron-right" aria-hidden="true"></i>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">{t('dashboard.registrar.quickActions.title')}</div>
            </div>
            <div className="quick-actions-grid">
              {quickActions.map(a => (
                <button className="btn-sm" key={a.key} onClick={a.onClick}>
                  <i className={'ti ' + a.icon}></i> {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
