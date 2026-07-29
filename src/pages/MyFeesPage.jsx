import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import ReceiptView from '../components/ReceiptView.jsx';
import { fetchMyFinance } from '../api.js';
import { installmentLabel } from '../utils.js';

const INSTALLMENT_PILL = { paid: 'pill-green', partial: 'pill-amber', overdue: 'pill-red', pending: 'pill-gray' };

/** A student's own fee statement: per-course charges, fixed fees, financial aid, installment
    schedule, totals, receipts, and a prominent hold banner (an unpaid balance blocks their
    midterm/final exams, enforced on the backend). */
export default function MyFeesPage() {
  const { t } = useTranslation(['finance', 'common']);
  const { currentUser } = useAppData();
  const { activeSection } = useNavigation();
  const [data, setData] = useState(null);
  const [receiptId, setReceiptId] = useState(null);

  useEffect(() => {
    if (currentUser.role !== 'student') return;
    let cancelled = false;
    fetchMyFinance().then(d => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser.role, activeSection]);

  const money = (n) => `${Number(n || 0).toLocaleString()}${data?.currency ? ' ' + data.currency : ''}`;
  const feesConfigured = !!data?.term?.generated;

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
                  {data.term.courseLines.map(c => (
                    <tr key={`c${c.refId}`}><td>{c.label}</td><td>{c.quantity}</td><td>{money(c.amount)}</td></tr>
                  ))}
                  {data.term.feeLines.map(f => (
                    <tr key={`f${f.refId}`}><td>{f.label}</td><td>—</td><td>{money(f.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: 14 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:myFees.totalCharged')}</div><strong>{money(data.totalCharged)}</strong></div>
                {data.totalAid > 0 && (
                  <>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:myFees.totalAid')}</div><strong>{money(data.totalAid)}</strong></div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:myFees.netPayable')}</div><strong>{money(data.netPayable)}</strong></div>
                  </>
                )}
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:myFees.totalPaid')}</div><strong>{money(data.totalPaid)}</strong></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:myFees.balance')}</div>
                  <strong style={{ color: data.hasHold ? 'var(--danger, #d33)' : 'inherit' }}>{money(data.balance)}</strong></div>
                {data.creditBalance > 0 && (
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:myFees.creditBalance')}</div>
                    <strong style={{ color: 'var(--success, #2a2)' }}>{money(data.creditBalance)}</strong></div>
                )}
              </div>
            </div>

            {data.term.installments.length > 0 && (
              <div className="panel" style={{ marginBottom: 16 }}>
                <div style={{ padding: '10px 14px', fontWeight: 600 }}>{t('finance:myFees.installments')}</div>
                <table className="data-table">
                  <thead><tr><th></th><th>{t('finance:myFees.amount')}</th><th>{t('finance:financePage.installments.dueDate')}</th><th>{t('finance:financePage.columns.status')}</th></tr></thead>
                  <tbody>
                    {data.term.installments.map(i => (
                      <tr key={i.installmentNo}>
                        <td>{installmentLabel(t, i.installmentNo)}</td><td>{money(i.amount)}</td><td>{i.dueDate || '—'}</td>
                        <td><span className={`pill ${INSTALLMENT_PILL[i.status] || 'pill-gray'}`}>{t(`finance:financePage.installments.status.${i.status}`)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(data.aid || []).some(a => a.status === 'active') && (
              <div className="panel" style={{ marginBottom: 16 }}>
                <div style={{ padding: '10px 14px', fontWeight: 600 }}>{t('finance:financePage.aid.title')}</div>
                <table className="data-table">
                  <thead><tr><th>{t('finance:financePage.aid.type')}</th><th>{t('finance:financePage.aid.value')}</th></tr></thead>
                  <tbody>
                    {data.aid.filter(a => a.status === 'active').map(a => (
                      <tr key={a.id}>
                        <td>{t(`finance:financePage.aid.types.${a.type}`)}</td>
                        <td>{a.basis === 'percentage' ? `${a.value}%` : money(a.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="panel">
              <div style={{ padding: '10px 14px', fontWeight: 600 }}>{t('finance:myFees.receipts')}</div>
              {data.payments.length === 0 ? (
                <div className="empty-state">{t('finance:myFees.noReceipts')}</div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>{t('finance:myFees.receiptNo')}</th><th>{t('finance:myFees.amount')}</th><th>{t('finance:myFees.method')}</th><th>{t('finance:myFees.date')}</th><th>{t('finance:myFees.installmentsCol')}</th><th></th></tr></thead>
                  <tbody>
                    {data.payments.map(p => (
                      <tr key={p.id} style={p.status === 'reversed' ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
                        <td><code>{p.receiptNo}</code>{p.status === 'reversed' && <span className="pill pill-gray" style={{ marginInlineStart: 6 }}>{t('finance:financePage.voidedLabel')}</span>}</td>
                        <td>{money(p.amount)}</td>
                        <td>{t(`finance:financePage.methods.${p.method || 'cash'}`)}</td>
                        <td>{(p.paidAt || '').split(' ')[0]}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(p.allocation || []).map(a => installmentLabel(t, a.installmentNo)).join(', ') || '—'}</td>
                        <td><button className="icon-btn" aria-label={t('finance:financePage.receipt.printAria', { receipt: p.receiptNo })} onClick={() => setReceiptId(p.id)}><i className="ti ti-receipt" aria-hidden="true"></i></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
      {receiptId && <ReceiptView paymentId={receiptId} onClose={() => setReceiptId(null)} />}
    </Section>
  );
}
