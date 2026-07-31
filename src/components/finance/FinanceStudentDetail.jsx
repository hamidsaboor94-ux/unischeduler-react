import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap.js';
import { installmentLabel, fmtLongDate } from '../../utils.js';

const STATUS_PILL = { cleared: 'pill-green', partial: 'pill-amber', outstanding: 'pill-gray', overdue: 'pill-red', not_billed: 'pill-blue' };
const METHODS = ['cash', 'bank', 'card', 'mobile', 'other'];
const INTER = "'Inter', var(--font-sans)";
const MONO = "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
// Tier colors reuse the app's four semantic status colors (red/green/amber/gray) — see CLAUDE.md
// styling constraints for this panel; nothing new invented here.
const TIER_META = {
  paid: { pill: 'pill-green', border: 'var(--success)' },
  due_next: { pill: 'pill-amber', border: 'var(--warning)' },
  overdue: { pill: 'pill-red', border: 'var(--danger)' },
  pending: { pill: 'pill-gray', border: 'var(--border-strong)' },
};

function round2(n) { return Math.round((n || 0) * 100) / 100; }

/** Splits a term's installments into paid / due-next / overdue / pending tiers by walking them
 *  oldest-first (they already arrive ordered by installmentNo, which tracks dueDate) and reading
 *  each row's `paidAmount` — the same FIFO pool computeAllocationPlan() applies server-side, so
 *  this never has to re-simulate allocation, just interpret its result. Exactly one unpaid
 *  installment (the earliest) is ever "due next"; anything unpaid behind it is either overdue or
 *  still pending depending on its own due date. */
function tierInstallments(installments) {
  const todayIso = new Date().toISOString().slice(0, 10);
  let dueNextAssigned = false;
  return installments.map(i => {
    const remaining = Math.max(0, round2((i.amount || 0) - (i.paidAmount || 0)));
    if (remaining <= 0.005) return { ...i, tier: 'paid', remaining: 0 };
    if (!dueNextAssigned) { dueNextAssigned = true; return { ...i, tier: 'due_next', remaining }; }
    const overdue = !!i.dueDate && i.dueDate < todayIso;
    return { ...i, tier: overdue ? 'overdue' : 'pending', remaining };
  });
}

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
  const [selectedInstallmentNo, setSelectedInstallmentNo] = useState(null);
  // Whichever installment a click most recently pre-filled the amount for should stop looking
  // "selected" once we've moved to a different student's statement or a payment has just posted
  // (the row it pointed at may no longer be unpaid).
  useEffect(() => { setSelectedInstallmentNo(null); }, [selected.student.id, selected.payments.length]);

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

  // Net payable already has aid netted out server-side (finance.js's computeStudentTotals) — every
  // figure below reads that value straight off `selected`, never recomputing gross vs. aid itself.
  const netPayable = selected.netPayable || 0;
  const totalPaid = selected.totalPaid || 0;
  const balance = selected.balance || 0;
  const hasBilling = netPayable > 0 || totalPaid > 0;
  const progressPct = netPayable > 0 ? Math.max(0, Math.min(100, Math.round((totalPaid / netPayable) * 100))) : 0;
  // Same three-way read (paid in full / partially paid / overdue) drives both the header badge and
  // the progress bar's fill color, so they never disagree with each other.
  const billingTier = !hasBilling ? null : balance <= 0.005 ? 'paid' : totalPaid > 0.005 ? 'partial' : 'overdue';
  const badge = billingTier && {
    paid: { pill: 'pill-green', label: t('finance:financePage.paidInFull') },
    partial: { pill: 'pill-amber', label: t('finance:financePage.partiallyPaid') },
    overdue: { pill: 'pill-red', label: t('finance:financePage.status.overdue') },
  }[billingTier];
  const progressColor = billingTier === 'paid' ? 'var(--success)' : billingTier === 'partial' ? 'var(--warning)' : billingTier === 'overdue' ? 'var(--danger)' : 'var(--border-strong)';

  const tieredInstallments = selected.term ? tierInstallments(selected.term.installments) : [];
  const dueNextInstallment = tieredInstallments.find(i => i.tier === 'due_next');

  function selectInstallment(inst) {
    if (inst.tier === 'paid') return;
    setAmount(String(inst.remaining));
    setSelectedInstallmentNo(inst.installmentNo);
  }
  function payNextInstallment() {
    if (!dueNextInstallment) return;
    setAmount(String(dueNextInstallment.remaining));
    setSelectedInstallmentNo(dueNextInstallment.installmentNo);
  }
  function payFullBalance() {
    if (!(balance > 0.005)) return;
    setAmount(String(balance));
    setSelectedInstallmentNo(null);
  }

  return createPortal(
    <div className="fin-drawer-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fin-drawer" ref={boxRef} role="dialog" aria-modal="true" aria-label={t('finance:financePage.statementTitle')} style={{ fontFamily: INTER }}>
        <div className="fin-drawer-header">
          <div>
            <div className="fin-drawer-title">{selected.student.name}</div>
            <div className="fin-drawer-subtitle">{selected.student.idNumber}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`pill ${badge ? badge.pill : STATUS_PILL[selected.status] || 'pill-gray'}`}>{badge ? badge.label : t(`finance:financePage.status.${selected.status}`)}</span>
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
                  <div className="fin-charge-line-amt" style={{ fontFamily: MONO }}>{money(c.amount)}</div>
                </div>
              ))}
              {selected.term.feeLines.map(f => (
                <div className="fin-charge-line" key={`f${f.refId}`}>
                  <div className="fin-charge-line-label">{f.label}</div>
                  <div className="fin-charge-line-amt" style={{ fontFamily: MONO }}>{money(f.amount)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="fin-summary-stats">
            <div><div className="fin-summary-stat-label">{t('finance:financePage.totalCharged')}</div><div className="fin-summary-stat-value" style={{ fontFamily: MONO }}>{money(selected.totalCharged)}</div></div>
            {selected.totalAid > 0 && (
              <div><div className="fin-summary-stat-label">{t('finance:financePage.totalAid')}</div><div className="fin-summary-stat-value" style={{ fontFamily: MONO }}>{money(selected.totalAid)}</div></div>
            )}
            <div><div className="fin-summary-stat-label">{t('finance:financePage.netPayable')}</div><div className="fin-summary-stat-value" style={{ fontFamily: MONO }}>{money(selected.netPayable)}</div></div>
            <div><div className="fin-summary-stat-label">{t('finance:financePage.totalPaid')}</div><div className="fin-summary-stat-value" style={{ fontFamily: MONO }}>{money(selected.totalPaid)}</div></div>
            <div><div className="fin-summary-stat-label">{t('finance:financePage.balance')}</div>
              <div className="fin-summary-stat-value" style={{ fontFamily: MONO, color: selected.hasHold ? 'var(--danger)' : undefined }}>{money(selected.balance)}</div></div>
            {selected.creditBalance > 0 && (
              <div><div className="fin-summary-stat-label">{t('finance:financePage.creditBalance')}</div>
                <div className="fin-summary-stat-value" style={{ fontFamily: MONO, color: 'var(--success)' }}>{money(selected.creditBalance)}</div></div>
            )}
            {(pendingAid || activeAid.length > 0) ? (
              <div style={{ flexBasis: '100%' }}>
                <div className="fin-summary-stat-label">{t('finance:financePage.aid.title')}</div>
                <div className="fin-summary-stat-value" style={{ color: pendingAid ? 'var(--warning)' : 'var(--success)' }} title={pendingAid ? pendingAid.reason || undefined : activeAid.map(a => a.reason).filter(Boolean).join('; ') || undefined}>{aidStatus}</div>
              </div>
            ) : (
              <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--text-muted)' }}>{aidStatus}</div>
            )}
          </div>

          {hasBilling && (
            <div style={{ margin: '2px 0 14px' }}>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-recessed)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progressPct}%`, borderRadius: 3, background: progressColor, transition: 'width 0.2s ease' }}></div>
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO }}>
                {Number(totalPaid).toLocaleString()} / {Number(netPayable).toLocaleString()} {selected.currency}  {progressPct}%
              </div>
            </div>
          )}

          {selected.term && selected.term.installments.length > 0 && (
            <div className="fin-section">
              <div className="fin-section-title">{t('finance:financePage.installments.title')}</div>
              {tieredInstallments.map(i => {
                const meta = TIER_META[i.tier];
                const isSelected = canWrite && selectedInstallmentNo === i.installmentNo;
                const clickable = canWrite && i.tier !== 'paid';
                return (
                  <div
                    key={i.installmentNo}
                    className="fin-installment-row"
                    onClick={clickable ? () => selectInstallment(i) : undefined}
                    style={{
                      borderInlineStartWidth: 4, borderInlineStartStyle: 'solid',
                      borderInlineStartColor: isSelected ? 'var(--accent)' : meta.border,
                      background: isSelected ? 'var(--accent-dim)' : undefined,
                      boxShadow: isSelected ? '0 0 0 1px var(--accent)' : undefined,
                      opacity: i.tier === 'paid' ? 0.65 : 1,
                      cursor: clickable ? 'pointer' : 'default',
                    }}
                  >
                    <div>
                      <div className="fin-installment-name">{installmentLabel(t, i.installmentNo)}</div>
                      <div className="fin-installment-due">{t('finance:financePage.installments.dueDate')}: {fmtLongDate(i.dueDate)}</div>
                    </div>
                    <div className="fin-installment-amt-wrap">
                      <div className="fin-installment-amt" style={{ fontFamily: MONO }}>{money(i.amount)}</div>
                      <span className={`pill ${meta.pill}`}>
                        {i.tier === 'paid' && <i className="ti ti-check" aria-hidden="true"></i>}
                        {' '}{i.tier === 'due_next' ? t('finance:financePage.installments.dueNextTag') : t(`finance:financePage.installments.status.${i.tier}`)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {canWrite && (
            <div className="fin-section">
              <div className="fin-section-title">{t('finance:financePage.recordPayment')}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <button
                  type="button" className="btn-sm" disabled={!dueNextInstallment} onClick={payNextInstallment}
                  style={{ opacity: dueNextInstallment ? 1 : 0.5, cursor: dueNextInstallment ? 'pointer' : 'not-allowed' }}
                >
                  <i className="ti ti-calendar-event" aria-hidden="true"></i>
                  {t('finance:financePage.payNextInstallment', { amount: dueNextInstallment ? money(dueNextInstallment.remaining) : '—' })}
                </button>
                <button
                  type="button" className="btn-sm" disabled={!(balance > 0.005)} onClick={payFullBalance}
                  style={{ opacity: balance > 0.005 ? 1 : 0.5, cursor: balance > 0.005 ? 'pointer' : 'not-allowed' }}
                >
                  <i className="ti ti-wallet" aria-hidden="true"></i>
                  {t('finance:financePage.payFullBalance', { amount: balance > 0.005 ? money(balance) : '—' })}
                </button>
              </div>
              <div className="fin-form-panel">
                <div className="fin-form-row">
                  <input type="number" min="0" className="select-sm" style={{ width: 110, fontFamily: MONO }} placeholder={t('finance:financePage.amount')} value={amount} onChange={e => setAmount(e.target.value)} />
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
                      <td style={{ fontFamily: MONO }}>{money(p.amount)}</td>
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
