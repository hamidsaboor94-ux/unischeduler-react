import { useTranslation } from 'react-i18next';
import { useNavigation } from '../../context/NavigationContext.jsx';

/** Quick Insights strip — all four counts are derived client-side from the same `students`
 *  worklist the billing-status table renders (GET /finance/students), so "Total Students" is
 *  every student on record (billed or not — the worklist already covers the whole roster, see
 *  financeWorklist() in api/src/finance.js), not just those charged this term. Reuses the
 *  `.snapshot-*` tile pattern already used for this kind of at-a-glance strip elsewhere
 *  (SuperAdminDashboard's Academic Snapshot). */
export default function FinanceQuickInsights({ students }) {
  const { t } = useTranslation(['finance', 'common']);
  const { showSection } = useNavigation();

  const totalStudents = students.length;
  const paidThisTerm = students.filter(s => s.status === 'cleared').length;
  const pendingPayments = students.filter(s => s.status === 'outstanding' || s.status === 'partial' || s.status === 'overdue').length;
  // Overdue students already has its own stat card (FinanceStatCards) — showing it a second time
  // here duplicated the same number, so this tile surfaces a different, currently-invisible signal
  // instead: how many of this term's roster haven't been billed at all yet.
  const notBilled = students.filter(s => s.status === 'not_billed').length;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-header">
        <div className="panel-title">{t('finance:financePage.dashboard.quickInsights.title')}</div>
        <button className="btn-sm" onClick={() => showSection('reports')}>
          {t('finance:financePage.dashboard.quickInsights.viewReports')} <i className="ti ti-arrow-narrow-right" aria-hidden="true"></i>
        </button>
      </div>
      <div className="snapshot-strip">
        <div className="snapshot-tile">
          <div className="snapshot-value">{totalStudents}</div>
          <div className="snapshot-label">{t('finance:financePage.dashboard.quickInsights.totalStudents')}</div>
        </div>
        <div className="snapshot-tile">
          <div className="snapshot-value">{paidThisTerm}</div>
          <div className="snapshot-label">{t('finance:financePage.dashboard.quickInsights.paidThisTerm')}</div>
        </div>
        <div className="snapshot-tile">
          <div className="snapshot-value">{pendingPayments}</div>
          <div className="snapshot-label">{t('finance:financePage.dashboard.quickInsights.pendingPayments')}</div>
        </div>
        <div className="snapshot-tile">
          <div className="snapshot-value">{notBilled}</div>
          <div className="snapshot-label">{t('finance:financePage.dashboard.quickInsights.notBilled')}</div>
        </div>
      </div>
    </div>
  );
}
