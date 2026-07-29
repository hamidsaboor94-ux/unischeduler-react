import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { StatCard } from './ui/StatCard.jsx';
import FinanceStatCards from './finance/FinanceStatCards.jsx';
import ReceiptView from './ReceiptView.jsx';
import {
  fetchFinanceStudents, fetchOverdueInstallments, fetchUpcomingInstallments, fetchRecentFinancialActivity,
} from '../api.js';
import { summarizeFinanceWorklist, findPreviousTermId, fmtDate } from '../utils.js';

const RECENT_PAYMENTS_LIMIT = 8;

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Bursar's landing dashboard — billing/collections figures only, replacing the generic
 *  scheduling stat cards every other staff role still sees (see DashboardPage.jsx). The 4 stat
 *  cards reuse FinanceStatCards + summarizeFinanceWorklist verbatim (same reduction the redesigned
 *  Finance page runs over the same GET /finance/students worklist), so these numbers can never
 *  drift from what the Finance page shows for the same term — see utils.js. Every other figure
 *  (overdue balances, upcoming installments, recent payments) comes straight from the finance.js
 *  aggregate endpoints, all gated server-side by requirePermission('finance','read') — the same
 *  guard the Finance page's own calls use, so this dashboard requests nothing a Bursar couldn't
 *  already reach directly. */
export default function BursarDashboard() {
  const { t } = useTranslation(['dashboard', 'finance', 'common']);
  const { terms, activeTermId } = useAppData();
  const { showSection } = useNavigation();

  const termId = activeTermId || null;

  const [students, setStudents] = useState(null);
  const [currency, setCurrency] = useState('');
  const [previousSummary, setPreviousSummary] = useState(null);
  const [overdue, setOverdue] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [recentPayments, setRecentPayments] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [receiptId, setReceiptId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchFinanceStudents(termId),
      fetchOverdueInstallments(termId),
      fetchUpcomingInstallments(termId, 30),
      fetchRecentFinancialActivity(termId, RECENT_PAYMENTS_LIMIT * 3), // over-fetch a little — will filter to payments client-side
    ]).then(([worklist, overdueList, upcomingList, activity]) => {
      if (cancelled) return;
      setStudents(worklist.students);
      setCurrency(worklist.currency || '');
      setOverdue(overdueList);
      setUpcoming(upcomingList);
      setRecentPayments(activity.filter(a => a.type === 'payment').slice(0, RECENT_PAYMENTS_LIMIT));
    }).catch(() => { if (!cancelled) setLoadError(true); });

    const previousTermId = findPreviousTermId(terms, termId);
    if (previousTermId) {
      fetchFinanceStudents(previousTermId)
        .then(res => { if (!cancelled) setPreviousSummary(summarizeFinanceWorklist(res.students)); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [termId]); // eslint-disable-line react-hooks/exhaustive-deps

  const money = (n) => `${Number(n || 0).toLocaleString()}${currency ? ' ' + currency : ''}`;
  const summary = students ? summarizeFinanceWorklist(students) : null;

  return (
    <div className="bursar-dash">
      <div className="dash-welcome-row">
        <div>
          <div className="dash-welcome-title">{t('dashboard.bursar.header.title')}</div>
          <div className="panel-subtitle">{t('dashboard.bursar.header.subtitle')}</div>
        </div>
      </div>

      {loadError && (
        <div className="dash-notice" style={{ marginBottom: 14 }}>
          <i className="ti ti-alert-triangle" aria-hidden="true"></i>
          <div className="dash-notice-msg">{t('dashboard.bursar.loadError')}</div>
        </div>
      )}

      {!termId && (
        <div className="dash-notice" style={{ marginBottom: 14 }}>
          <i className="ti ti-info-circle" aria-hidden="true"></i>
          <div className="dash-notice-msg">{t('dashboard.bursar.noActiveTerm')}</div>
        </div>
      )}

      {summary ? (
        <FinanceStatCards summary={summary} previousSummary={previousSummary} money={money} />
      ) : (
        <div className="stat-grid">
          {[
            { key: 'charged', labelKey: 'totalCharged' },
            { key: 'collected', labelKey: 'collected' },
            { key: 'outstanding', labelKey: 'outstanding' },
            { key: 'overdue', labelKey: 'overdueStudents' },
          ].map(c => (
            <StatCard key={c.key} icon="ti-cash-banknote" hue="indigo" label={t(`finance:financePage.summary.${c.labelKey}`)} value="—" />
          ))}
        </div>
      )}

      <div className="panel-row dash-two-col">
        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.bursar.overdue.title')}</div>
                <div className="panel-subtitle">{t('dashboard.bursar.overdue.subtitle')}</div>
              </div>
              <button className="btn-sm" onClick={() => showSection('finance')}>{t('dashboard.bursar.viewAll')}</button>
            </div>
            <div className="alert-list">
              {!overdue && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
              {overdue && overdue.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.bursar.overdue.empty')}</div>}
              {overdue && overdue.slice(0, 8).map(row => (
                <div
                  className="alert-item alert-neutral" key={row.studentId} role="button" tabIndex={0}
                  onClick={() => showSection('finance', { studentId: row.studentId })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showSection('finance', { studentId: row.studentId }); } }}
                >
                  <span className="pill pill-red">{t('dashboard.bursar.overdue.daysOverdue', { count: row.daysOverdue })}</span>
                  <div style={{ flex: 1 }}>
                    <div className="alert-title">{row.name}</div>
                    <div className="alert-desc">{row.idNumber || ''}</div>
                  </div>
                  <div className="dash-figure-mono">{money(row.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.bursar.upcoming.title')}</div>
                <div className="panel-subtitle">{t('dashboard.bursar.upcoming.subtitle')}</div>
              </div>
            </div>
            <div className="alert-list">
              {!upcoming && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
              {upcoming && upcoming.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.bursar.upcoming.empty')}</div>}
              {upcoming && upcoming.map(row => (
                <div className="alert-item alert-neutral dash-queue-row--static" key={row.dueDate}>
                  <span className="pill pill-amber">{fmtDate(row.dueDate)}</span>
                  <div style={{ flex: 1 }}>
                    <div className="alert-title">{t('dashboard.bursar.upcoming.studentCount', { count: row.studentCount })}</div>
                  </div>
                  <div className="dash-figure-mono">{money(row.totalExpected)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">{t('dashboard.bursar.recentPayments.title')}</div>
            <div className="panel-subtitle">{t('dashboard.bursar.recentPayments.subtitle')}</div>
          </div>
        </div>
        <div className="alert-list">
          {!recentPayments && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
          {recentPayments && recentPayments.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.bursar.recentPayments.empty')}</div>}
          {recentPayments && recentPayments.map(p => (
            <div
              className="alert-item alert-neutral" key={p.id} role="button" tabIndex={0}
              onClick={() => p.paymentId != null && setReceiptId(p.paymentId)}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && p.paymentId != null) { e.preventDefault(); setReceiptId(p.paymentId); } }}
            >
              <span className="pill pill-green">{p.receiptNo || '—'}</span>
              <div style={{ flex: 1 }}>
                <div className="alert-title">{p.studentName}</div>
                <div className="alert-desc">{fmtDateTime(p.createdAt)}</div>
              </div>
              <div className="dash-figure-mono">{money(p.amount)}</div>
            </div>
          ))}
        </div>
      </div>

      {receiptId != null && <ReceiptView paymentId={receiptId} onClose={() => setReceiptId(null)} />}
    </div>
  );
}
