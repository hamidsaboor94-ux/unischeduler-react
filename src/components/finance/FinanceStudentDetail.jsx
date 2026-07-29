import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap.js';
import { installmentLabel } from '../../utils.js';

const STATUS_PILL = { cleared: 'pill-green', partial: 'pill-amber', outstanding: 'pill-gray', overdue: 'pill-red', not_billed: 'pill-blue' };
const INSTALLMENT_PILL = { paid: 'pill-green', partial: 'pill-amber', overdue: 'pill-red', pending: 'pill-gray' };
const METHODS = ['cash', 'bank', 'card', 'mobile', 'other'];

/** One student's full fee statement — charge breakdown, summary totals, installment schedule,
 *  record-payment form, and payments/receipts history. Relocated from the always-visible
 *  split-panel layout into a slide-over drawer opened by clicking a row in the Student Billing
 *  Status table. Portalled to document.body like FeeConfigDrawer/ReceiptView so it isn't clipped
 *  by the panels' own scroll containers.
 *  Financial aid is shown here only as a read-only summary line (`aidStatus` below) — awarding and
 *  revoking aid now happens from within the student's admissions application, not from Finance.
 *  Aid still posts to the same student_financial_aid table and finance_transactions ledger, so
 *  totals/balance/net payable everywhere (this drawer, the Student Billing Status table, the
 *  dashboard summary cards) always agree — there's exactly one billing computation (finance.js's
 *  computeStudentTotals). */
export default function FinanceStudentDetail({
  onClose, selected, termId, canWrite, money,
  amount, setAmount, method, setMethod, reference, setReference, submitPayment, paying,
  doVoid, onOpenReceipt,
}) {
  const { t } = useTranslation(['finance', 'common']);
  const boxRef = useRef(null);
  useModalFocusTrap(true, boxRef, onClose);

  const activeAid = selected.aid.filter(a => a.status === 'active' && (!termId || a.termId === termId));
  // Before charges are generated for this term, there's no student_financial_aid row yet (it's
  // only created by generateCharges's syncApplicationAid) — so preview whatever aid is currently
  // set on the application instead of showing "none" for an award that just hasn't taken effect yet.
  const pendingAid = !selected.term?.generated ? selected.term?.pendingAid : null;
  const aidStatus = pendingAid
    ? `${t(`finance:financePage.aid.types.${pendingAid.type}`)} (${pendingAid.basis === 'percentage' ? `${pendingAid.value}%` : money(pendingAid.amount)}) — ${t('finance:financePage.aid.pending')}`
    : activeAid.length === 0
    ? t('finance:financePage.aid.none')
    : activeAid.map(a => `${t(`finance:financePage.aid.types.${a.type}`)} (${a.basis === 'percentage' ? `${a.value}%` : money(a.value)})`).join(', ');

  return createPortal(
    <div className="fin-drawer-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fin-drawer" ref={boxRef} role="dialog" aria-modal="true" aria-label={t('finance:financePage.statementTitle')}>
        <div className="fin-drawer-header">
          <div>
            <div className="fin-drawer-title">{selected.student.name}</div>
            <div className="fin-drawer-subtitle">{selected.student.idNumber}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`pill ${STATUS_PILL[selected.status] || 'pill-gray'}`}>{t(`finance:financePage.status.${selected.status}`)}</span>
            <button className="modal-close" aria-label={t('common:actions.close')} onClick={onClose}><i className="ti ti-x" aria-hidden="true"></i></button>
          </div>
        </div>
        <div className="fin-drawer-body">
          {!termId ? (
            <div className="field-hint" style={{ margin: '10px 0' }}>{t('finance:financePage.noTermSelected')}</div>
          ) : !selected.term?.generated ? (
            <div className="field-hint" style={{ margin: '10px 0' }}>{t('finance:financePage.notGeneratedYet')}</div>
          ) : null}

          {selected.term && (selected.term.courseLines.length > 0 || selected.term.feeLines.length > 0) && (
            <div className="fin-charge-card">
              {selected.term.courseLines.map(c => (
                <div className="fin-charge-line" key={`c${c.refId}`}>
                  <div>
                    <div className="fin-charge-line-label">{c.label}</div>
                    {c.quantity ? <div className="fin-charge-line-sub">{c.quantity} {t('finance:financePage.credits')}</div> : null}
                  </div>
                  <div className="fin-charge-line-amt">{money(c.amount)}</div>
                </div>
              ))}
              {selected.term.feeLines.map(f => (
                <div className="fin-charge-line" key={`f${f.refId}`}>
                  <div className="fin-charge-line-label">{f.label}</div>
                  <div className="fin-charge-line-amt">{money(f.amount)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="fin-summary-stats">
            <div><div className="fin-summary-stat-label">{t('finance:financePage.totalCharged')}</div><div className="fin-summary-stat-value">{money(selected.totalCharged)}</div></div>
            {selected.totalAid > 0 && (
              <div><div className="fin-summary-stat-label">{t('finance:financePage.totalAid')}</div><div className="fin-summary-stat-value">{money(selected.totalAid)}</div></div>
            )}
            <div><div className="fin-summary-stat-label">{t('finance:financePage.netPayable')}</div><div className="fin-summary-stat-value">{money(selected.netPayable)}</div></div>
            <div><div className="fin-summary-stat-label">{t('finance:financePage.totalPaid')}</div><div className="fin-summary-stat-value">{money(selected.totalPaid)}</div></div>
            <div><div className="fin-summary-stat-label">{t('finance:financePage.balance')}</div>
              <div className="fin-summary-stat-value" style={{ color: selected.hasHold ? 'var(--danger)' : undefined }}>{money(selected.balance)}</div></div>
            {selected.creditBalance > 0 && (
              <div><div className="fin-summary-stat-label">{t('finance:financePage.creditBalance')}</div>
                <div className="fin-summary-stat-value" style={{ color: 'var(--success)' }}>{money(selected.creditBalance)}</div></div>
            )}
            <div style={{ flexBasis: '100%' }}>
              <div className="fin-summary-stat-label">{t('finance:financePage.aid.title')}</div>
              <div className="fin-summary-stat-value" style={{ color: pendingAid ? 'var(--warning)' : activeAid.length > 0 ? 'var(--success)' : undefined }} title={pendingAid ? pendingAid.reason || undefined : activeAid.map(a => a.reason).filter(Boolean).join('; ') || undefined}>{aidStatus}</div>
            </div>
          </div>

          {selected.term && selected.term.installments.length > 0 && (
            <div className="fin-section">
              <div className="fin-section-title">{t('finance:financePage.installments.title')}</div>
              {selected.term.installments.map(i => (
                <div className="fin-installment-row" key={i.installmentNo}>
                  <div>
                    <div className="fin-installment-name">{installmentLabel(t, i.installmentNo)}</div>
                    <div className="fin-installment-due">{t('finance:financePage.installments.dueDate')}: {i.dueDate || '—'}</div>
                  </div>
                  <div className="fin-installment-amt-wrap">
                    <div className="fin-installment-amt">{money(i.amount)}</div>
                    <span className={`pill ${INSTALLMENT_PILL[i.status] || 'pill-gray'}`}>{t(`finance:financePage.installments.status.${i.status}`)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {canWrite && (
            <div className="fin-section">
              <div className="fin-section-title">{t('finance:financePage.recordPayment')}</div>
              <div className="fin-form-panel">
                <div className="fin-form-row">
                  <input type="number" min="0" className="select-sm" style={{ width: 110 }} placeholder={t('finance:financePage.amount')} value={amount} onChange={e => setAmount(e.target.value)} />
                  <select className="select-sm" value={method} onChange={e => setMethod(e.target.value)}>
                    {METHODS.map(m => <option key={m} value={m}>{t(`finance:financePage.methods.${m}`)}</option>)}
                  </select>
                  <input type="text" className="select-sm" style={{ width: 130 }} placeholder={t('finance:financePage.reference')} value={reference} onChange={e => setReference(e.target.value)} />
                  <button className={'btn-primary' + (paying ? ' btn-loading' : '')} disabled={paying} onClick={submitPayment}>
                    {paying ? <span className="spinner"></span> : <><i className="ti ti-plus"></i> {t('finance:financePage.record')}</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="fin-section">
            <div className="fin-section-title">{t('finance:financePage.payments')}</div>
            {selected.payments.length === 0 ? (
              <div className="empty-state">{t('finance:financePage.noPayments')}</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>{t('finance:financePage.receiptNo')}</th><th>{t('finance:financePage.amount')}</th><th>{t('finance:financePage.method')}</th><th>{t('finance:financePage.date')}</th><th>{t('finance:financePage.installmentsCol')}</th><th></th>{canWrite && <th></th>}</tr></thead>
                <tbody>
                  {selected.payments.map(p => (
                    <tr key={p.id} style={p.status === 'reversed' ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
                      <td><code>{p.receiptNo}</code></td>
                      <td>{money(p.amount)}</td>
                      <td>{t(`finance:financePage.methods.${p.method || 'cash'}`)}</td>
                      <td>{(p.paidAt || '').split(' ')[0]}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(p.allocation || []).map(a => installmentLabel(t, a.installmentNo)).join(', ') || '—'}</td>
                      <td><button className="icon-btn" aria-label={t('finance:financePage.receipt.printAria', { receipt: p.receiptNo })} onClick={() => onOpenReceipt(p.id)}><i className="ti ti-receipt" aria-hidden="true"></i></button></td>
                      {canWrite && (
                        <td>
                          {p.status === 'reversed' ? (
                            <span className="pill pill-gray">{t('finance:financePage.voidedLabel')}</span>
                          ) : (
                            <button className="icon-btn danger" aria-label={t('finance:financePage.voidAria', { receipt: p.receiptNo })} onClick={() => doVoid(p)}><i className="ti ti-trash" aria-hidden="true"></i></button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
