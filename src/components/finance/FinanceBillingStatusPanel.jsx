import { useTranslation } from 'react-i18next';

const STATUS_PILL = { cleared: 'pill-green', partial: 'pill-amber', outstanding: 'pill-gray', overdue: 'pill-red', not_billed: 'pill-blue' };
const STATUS_FILTERS = ['all', 'overdue', 'partial', 'cleared', 'not_billed'];

/** "Student Billing Status" — search + live-count filter tabs + the full student worklist table.
 *  Every row/count here comes straight from the `students` worklist FinancePage already loads
 *  (GET /finance/students); this component only searches/filters/renders it. Clicking a row hands
 *  off to FinancePage's onSelectStudent, which opens the detail drawer (record-payment,
 *  installments, aid, receipts — unchanged business logic, just relocated out of the old split
 *  layout — see FinanceStudentDetail.jsx). */
export default function FinanceBillingStatusPanel({ students, search, setSearch, statusFilter, setStatusFilter, money, selectedStudentId, onSelectStudent }) {
  const { t } = useTranslation(['finance', 'common']);

  const filterCounts = STATUS_FILTERS.reduce((acc, key) => {
    acc[key] = key === 'all' ? students.length : students.filter(s => s.status === key).length;
    return acc;
  }, {});
  const q = search.trim().toLowerCase();
  const bySearch = q ? students.filter(s => (s.name || '').toLowerCase().includes(q) || (s.idNumber || '').toLowerCase().includes(q)) : students;
  const shown = statusFilter === 'all' ? bySearch : bySearch.filter(s => s.status === statusFilter);

  return (
    <div className="panel fin-billing-panel">
      <div className="panel-title" style={{ marginBottom: 12 }}>{t('finance:financePage.dashboard.billingStatus.title')}</div>
      <div className="fin-billing-toolbar">
        <input
          type="text" className="select-sm" style={{ flex: 1, minWidth: 200 }}
          placeholder={t('finance:financePage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
        />
        <div className="fin-pill-tabs" style={{ padding: 0 }}>
          {STATUS_FILTERS.map(key => (
            <button
              key={key} type="button" className={'fin-pill-tab' + (statusFilter === key ? ' active' : '')}
              onClick={() => setStatusFilter(key)}
            >
              {key === 'all' ? t('finance:financePage.filters.all') : t(`finance:financePage.status.${key}`)}
              <span className="fin-pill-tab-count">{filterCounts[key]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="fin-billing-table-wrap">
        {shown.length === 0 ? (
          <div className="empty-state">{t('finance:financePage.noStudents')}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('finance:financePage.columns.student')}</th>
                <th>{t('finance:financePage.columns.charged')}</th>
                <th>{t('finance:financePage.columns.aid')}</th>
                <th>{t('finance:financePage.columns.net')}</th>
                <th>{t('finance:financePage.columns.paid')}</th>
                <th>{t('finance:financePage.columns.balance')}</th>
                <th>{t('finance:financePage.columns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(s => (
                <tr key={s.studentId} className={selectedStudentId === s.studentId ? 'fin-row-active' : undefined} onClick={() => onSelectStudent(s.studentId)}>
                  <td>
                    <div className="fin-student-name">{s.name}</div>
                    <div className="fin-student-idnum">{s.idNumber}</div>
                  </td>
                  <td>{money(s.totalCharged)}</td>
                  <td style={s.totalAid > 0 ? { color: 'var(--success)' } : undefined}>{s.totalAid > 0 ? `− ${money(s.totalAid)}` : '—'}</td>
                  <td>{money(s.netPayable)}</td>
                  <td>{money(s.totalPaid)}</td>
                  <td>{money(s.balance)}</td>
                  <td><span className={`pill ${STATUS_PILL[s.status] || 'pill-gray'}`}>{t(`finance:financePage.status.${s.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
