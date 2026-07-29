import { useTranslation } from 'react-i18next';
import { StatCard } from '../ui/StatCard.jsx';
import { financeDeltaPct } from '../../utils.js';

/** The four headline stat cards — shared by the Finance page and the Bursar dashboard. `summary`
 *  is the same client-side reduction of the current term's worklist (summarizeFinanceWorklist in
 *  utils.js) every consumer computes; `previousSummary` is the identical reduction run against
 *  the prior term's worklist (or null if there is none / it hasn't loaded yet). */
export default function FinanceStatCards({ summary, previousSummary, money }) {
  const { t } = useTranslation(['finance', 'common']);

  const cards = [
    {
      key: 'charged', icon: 'ti-report-money', hue: 'indigo',
      label: t('finance:financePage.summary.totalCharged'),
      value: money(summary.totalCharged),
      delta: financeDeltaPct(summary.totalCharged, previousSummary?.totalCharged),
    },
    {
      key: 'collected', icon: 'ti-cash-banknote', hue: 'teal',
      label: t('finance:financePage.summary.collected'),
      value: money(summary.totalPaid),
      delta: financeDeltaPct(summary.totalPaid, previousSummary?.totalPaid),
    },
    {
      key: 'outstanding', icon: 'ti-clock-dollar', hue: 'amber',
      label: t('finance:financePage.summary.outstanding'),
      value: money(summary.balance),
      delta: financeDeltaPct(summary.balance, previousSummary?.balance),
    },
    {
      key: 'overdue', icon: 'ti-alert-triangle', hue: 'red',
      label: t('finance:financePage.summary.overdueStudents'),
      value: summary.overdueCount,
      delta: financeDeltaPct(summary.overdueCount, previousSummary?.overdueCount),
    },
  ];

  return (
    <div className="stat-grid">
      {cards.map(c => (
        <StatCard
          key={c.key}
          icon={c.icon}
          hue={c.hue}
          label={c.label}
          value={c.value}
          sub={c.delta !== null ? t('finance:financePage.dashboard.vsLastTermPlain') : undefined}
          delta={c.delta !== null ? { label: `${c.delta > 0 ? '+' : ''}${c.delta}%`, tone: c.delta > 0 ? 'positive' : c.delta < 0 ? 'negative' : 'neutral' } : undefined}
        />
      ))}
    </div>
  );
}
