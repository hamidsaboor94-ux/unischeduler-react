import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { fetchMyFinance } from '../api.js';

/** A student's own fee statement: per-course charges, totals, receipts, and a
    prominent hold banner (an unpaid balance blocks their midterm/final exams,
    enforced on the backend). */
export default function MyFeesPage() {
  const { t } = useTranslation(['finance', 'common']);
  const { currentUser } = useAppData();
  const { activeSection } = useNavigation();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (currentUser.role !== 'student') return;
    let cancelled = false;
    fetchMyFinance().then(d => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser.role, activeSection]);

  const money = (n) => `${Number(n || 0).toLocaleString()}${data?.currency ? ' ' + data.currency : ''}`;
  const feesConfigured = data && data.rate > 0;

  return (
    <Section name="my-fees">
      <div className="topbar">
        <i className="ti ti-cash" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('finance:myFees.title')}</h2>
      </div>
      <div id="content">
        {!feesConfigured ? (
          <div className="panel"><div className="empty-state">{t('finance:myFees.noFees')}</div></div>
        ) : (
          <>
            {data.hasHold ? (
              <div className="panel" style={{ padding: 14, marginBottom: 16, borderInlineStart: '4px solid var(--danger, #d33)' }}>
                <strong style={{ color: 'var(--danger, #d33)' }}><i className="ti ti-alert-triangle" aria-hidden="true"></i> {t('finance:myFees.holdBanner', { amount: money(data.balance) })}</strong>
              </div>
            ) : (
              <div className="panel" style={{ padding: 14, marginBottom: 16, borderInlineStart: '4px solid var(--success, #2a2)' }}>
                <i className="ti ti-circle-check" aria-hidden="true"></i> {t('finance:myFees.clearBanner')}
              </div>
            )}

            <div className="panel" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <thead><tr><th>{t('finance:myFees.course')}</th><th>{t('finance:myFees.credits')}</th><th>{t('finance:myFees.fee')}</th></tr></thead>
                <tbody>
                  {data.courses.map(c => (
                    <tr key={c.id}><td>{c.code} — {c.name}</td><td>{c.credits}</td><td>{money(c.fee)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: 14 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:myFees.totalCharged')}</div><strong>{money(data.totalCharged)}</strong></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:myFees.totalPaid')}</div><strong>{money(data.totalPaid)}</strong></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:myFees.balance')}</div>
                  <strong style={{ color: data.hasHold ? 'var(--danger, #d33)' : 'inherit' }}>{money(data.balance)}</strong></div>
              </div>
            </div>

            <div className="panel">
              <div style={{ padding: '10px 14px', fontWeight: 600 }}>{t('finance:myFees.receipts')}</div>
              {data.payments.length === 0 ? (
                <div className="empty-state">{t('finance:myFees.noReceipts')}</div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>{t('finance:myFees.receiptNo')}</th><th>{t('finance:myFees.amount')}</th><th>{t('finance:myFees.method')}</th><th>{t('finance:myFees.date')}</th></tr></thead>
                  <tbody>
                    {data.payments.map(p => (
                      <tr key={p.id}>
                        <td><code>{p.receiptNo}</code></td>
                        <td>{money(p.amount)}</td>
                        <td>{t(`finance:financePage.methods.${p.method || 'cash'}`)}</td>
                        <td>{(p.paidAt || '').split(' ')[0]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
