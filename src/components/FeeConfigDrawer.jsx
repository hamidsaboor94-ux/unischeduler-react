import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap.js';
import { installmentLabel } from '../utils.js';

const FEE_SCOPES = ['university', 'college', 'department', 'program'];
const FEE_TYPES = ['tuition', 'registration', 'technology', 'library', 'laboratory', 'activity', 'transport', 'hostel', 'other'];

/** The College/Department/Program dropdown for one fee-scope row — only the level matching
    `scope` is shown, so a rule/item can't reference a scopeId that doesn't make sense for its
    scope. Ported from FinancePage.jsx unchanged. */
function ScopeTargetSelect({ scope, scopeId, onChange, colleges, departments, programs, t }) {
  if (scope === 'university') return null;
  const options = scope === 'college' ? colleges : scope === 'department' ? departments : programs;
  return (
    <select className="select-sm" value={scopeId} onChange={e => onChange(e.target.value)}>
      <option value="">{t('finance:financePage.feeRules.selectTarget')}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

/** Term Fee Configuration — rate/currency, student types, hierarchical fee rules, fixed fee items,
    and the installment plan: everything that sets billing POLICY rather than performs a billing
    operation, which is why FinancePage.jsx only opens this drawer for admins (Generate Charges is
    a separate, Bursar-accessible action living in the topbar instead — see the 2026-07-28
    Bursar/Admin permission split). All state and handlers are owned by FinancePage.jsx and passed
    straight through — nothing here talks to the API directly. Portalled to document.body like
    ReceiptView.jsx so it isn't clipped by the finance panels' own scroll containers. */
export default function FeeConfigDrawer({
  onClose, termName, money,
  rate, setRate, currency, setCurrency, saveRate,
  studentTypes, newTypeName, setNewTypeName, addStudentType, toggleStudentTypeActive, removeStudentType,
  termConfig, ruleForm, setRuleForm, addFeeRule, toggleFeeRuleActive, removeFeeRule,
  feeItemForm, setFeeItemForm, addFeeItem, removeFeeItem, toggleFeeItemActive,
  planForm, setInstallmentCount, updateInstallmentDef, savePlan,
  colleges, departments, programs,
}) {
  const { t } = useTranslation(['finance', 'common']);
  const boxRef = useRef(null);
  useModalFocusTrap(true, boxRef, onClose);

  return createPortal(
    <div className="fin-drawer-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fin-drawer" ref={boxRef} role="dialog" aria-modal="true" aria-label={t('finance:financePage.termConfig.title')}>
        <div className="fin-drawer-header">
          <div>
            <div className="fin-drawer-title">{t('finance:financePage.termConfig.title')}</div>
            {termName && <div className="fin-drawer-subtitle">{termName}</div>}
          </div>
          <button className="modal-close" aria-label={t('common:actions.close')} onClick={onClose}><i className="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div className="fin-drawer-body">
          <div className="fin-section">
            <div className="fin-section-title">{t('finance:financePage.rateLabel')}</div>
            <div className="fin-form-row" style={{ marginBottom: 6 }}>
              <input type="number" min="0" className="select-sm" style={{ width: 100 }} value={rate} onChange={e => setRate(e.target.value)} />
              <input type="text" className="select-sm" style={{ width: 80 }} placeholder={t('finance:financePage.currencyLabel')} value={currency} onChange={e => setCurrency(e.target.value)} />
              <button className="btn-sm" onClick={saveRate}><i className="ti ti-check"></i> {t('finance:financePage.save')}</button>
            </div>
            <div className="field-hint">{t('finance:financePage.rateHint')}</div>
          </div>

          <div className="fin-section">
            <div className="fin-section-title">{t('finance:financePage.studentTypes.title')}</div>
            <div className="fin-form-row">
              {studentTypes.map(st => (
                <span key={st.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 999, opacity: st.isActive ? 1 : 0.5 }}>
                  <span style={{ cursor: 'pointer' }} onClick={() => toggleStudentTypeActive(st)} title={t('finance:financePage.studentTypes.toggleHint')}>{st.name}</span>
                  <button className="icon-btn danger" aria-label={t('finance:financePage.studentTypes.removeAria', { name: st.name })} onClick={() => removeStudentType(st)}><i className="ti ti-x" aria-hidden="true"></i></button>
                </span>
              ))}
              <span style={{ display: 'inline-flex', gap: 6 }}>
                <input type="text" className="select-sm" placeholder={t('finance:financePage.studentTypes.addPlaceholder')} value={newTypeName} onChange={e => setNewTypeName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addStudentType(); }} />
                <button className="btn-sm" onClick={addStudentType}><i className="ti ti-plus"></i> {t('finance:financePage.studentTypes.add')}</button>
              </span>
            </div>
          </div>

          <div className="fin-section">
            <div className="fin-section-title">{t('finance:financePage.feeRules.title')}</div>
            <div className="field-hint" style={{ marginBottom: 8 }}>{t('finance:financePage.feeRules.hint')}</div>
            {(termConfig?.feeRules || []).length === 0 ? (
              <div className="empty-state">{t('finance:financePage.feeRules.none')}</div>
            ) : (
              <table className="data-table" style={{ marginBottom: 10 }}>
                <thead><tr>
                  <th>{t('finance:financePage.feeRules.scope')}</th><th>{t('finance:financePage.feeRules.target')}</th>
                  <th>{t('finance:financePage.feeRules.studentType')}</th><th>{t('finance:financePage.feeRules.rate')}</th>
                  <th>{t('finance:financePage.feeItems.active')}</th><th></th>
                </tr></thead>
                <tbody>
                  {(termConfig?.feeRules || []).map(r => (
                    <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.5 }}>
                      <td>{t(`finance:financePage.feeRules.scopes.${r.scope}`)}</td>
                      <td>{r.scopeName || '—'}</td>
                      <td>{r.studentTypeName || t('finance:financePage.feeRules.allTypes')}</td>
                      <td>{money(r.feePerCredit)}</td>
                      <td><input type="checkbox" checked={!!r.isActive} onChange={() => toggleFeeRuleActive(r)} /></td>
                      <td><button className="icon-btn danger" aria-label={t('finance:financePage.feeRules.remove')} onClick={() => removeFeeRule(r.id)}><i className="ti ti-trash" aria-hidden="true"></i></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="fin-form-row">
              <select className="select-sm" value={ruleForm.scope} onChange={e => setRuleForm(f => ({ ...f, scope: e.target.value, scopeId: '' }))}>
                {FEE_SCOPES.map(s => <option key={s} value={s}>{t(`finance:financePage.feeRules.scopes.${s}`)}</option>)}
              </select>
              <ScopeTargetSelect scope={ruleForm.scope} scopeId={ruleForm.scopeId} onChange={v => setRuleForm(f => ({ ...f, scopeId: v }))} colleges={colleges} departments={departments} programs={programs} t={t} />
              <select className="select-sm" value={ruleForm.studentTypeId} onChange={e => setRuleForm(f => ({ ...f, studentTypeId: e.target.value }))}>
                <option value="">{t('finance:financePage.feeRules.allTypes')}</option>
                {studentTypes.filter(st => st.isActive).map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
              <input type="number" min="0" className="select-sm" style={{ width: 100 }} placeholder={t('finance:financePage.feeRules.rate')} value={ruleForm.feePerCredit} onChange={e => setRuleForm(f => ({ ...f, feePerCredit: e.target.value }))} />
              <input type="date" className="select-sm" title={t('finance:financePage.feeItems.effectiveDate')} value={ruleForm.effectiveDate} onChange={e => setRuleForm(f => ({ ...f, effectiveDate: e.target.value }))} />
              <button className="btn-sm" onClick={addFeeRule}><i className="ti ti-plus"></i> {t('finance:financePage.feeRules.add')}</button>
            </div>
          </div>

          <div className="fin-section">
            <div className="fin-section-title">{t('finance:financePage.feeItems.title')}</div>
            {(termConfig?.feeItems || []).length === 0 ? (
              <div className="empty-state">{t('finance:financePage.feeItems.none')}</div>
            ) : (
              <table className="data-table" style={{ marginBottom: 10 }}>
                <thead><tr>
                  <th>{t('finance:financePage.feeItems.name')}</th><th>{t('finance:financePage.feeItems.amount')}</th>
                  <th>{t('finance:financePage.feeItems.appliesTo')}</th><th>{t('finance:financePage.feeItems.target')}</th>
                  <th>{t('finance:financePage.feeItems.studentType')}</th><th>{t('finance:financePage.feeItems.feeType')}</th>
                  <th>{t('finance:financePage.feeItems.mandatory')}</th><th>{t('finance:financePage.feeItems.active')}</th><th></th>
                </tr></thead>
                <tbody>
                  {(termConfig?.feeItems || []).map(f => (
                    <tr key={f.id} style={{ opacity: f.isActive ? 1 : 0.5 }}>
                      <td>{f.name}</td><td>{money(f.amount)}</td>
                      <td>{t(`finance:financePage.feeRules.scopes.${f.scope}`)}</td>
                      <td>{f.scopeName || '—'}</td>
                      <td>{f.studentTypeName || t('finance:financePage.feeRules.allTypes')}</td>
                      <td>{t(`finance:financePage.feeItems.feeTypes.${f.feeType}`)}</td>
                      <td>{f.mandatory ? t('common:actions.yes') : t('common:actions.no')}</td>
                      <td><input type="checkbox" checked={!!f.isActive} onChange={() => toggleFeeItemActive(f)} /></td>
                      <td><button className="icon-btn danger" aria-label={t('finance:financePage.feeItems.remove')} onClick={() => removeFeeItem(f.id)}><i className="ti ti-trash" aria-hidden="true"></i></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="fin-form-row" style={{ marginBottom: 6 }}>
              <input type="text" className="select-sm" style={{ width: 140 }} placeholder={t('finance:financePage.feeItems.name')} value={feeItemForm.name} onChange={e => setFeeItemForm(f => ({ ...f, name: e.target.value }))} />
              <input type="number" min="0" className="select-sm" style={{ width: 90 }} placeholder={t('finance:financePage.feeItems.amount')} value={feeItemForm.amount} onChange={e => setFeeItemForm(f => ({ ...f, amount: e.target.value }))} />
              <select className="select-sm" value={feeItemForm.feeType} onChange={e => setFeeItemForm(f => ({ ...f, feeType: e.target.value }))}>
                {FEE_TYPES.map(ft => <option key={ft} value={ft}>{t(`finance:financePage.feeItems.feeTypes.${ft}`)}</option>)}
              </select>
            </div>
            <div className="fin-form-row">
              <select className="select-sm" value={feeItemForm.scope} onChange={e => setFeeItemForm(f => ({ ...f, scope: e.target.value, scopeId: '' }))}>
                {FEE_SCOPES.map(s => <option key={s} value={s}>{t(`finance:financePage.feeRules.scopes.${s}`)}</option>)}
              </select>
              <ScopeTargetSelect scope={feeItemForm.scope} scopeId={feeItemForm.scopeId} onChange={v => setFeeItemForm(f => ({ ...f, scopeId: v }))} colleges={colleges} departments={departments} programs={programs} t={t} />
              <select className="select-sm" value={feeItemForm.studentTypeId} onChange={e => setFeeItemForm(f => ({ ...f, studentTypeId: e.target.value }))}>
                <option value="">{t('finance:financePage.feeRules.allTypes')}</option>
                {studentTypes.filter(st => st.isActive).map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
              <input type="date" className="select-sm" title={t('finance:financePage.feeItems.effectiveDate')} value={feeItemForm.effectiveDate} onChange={e => setFeeItemForm(f => ({ ...f, effectiveDate: e.target.value }))} />
              <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={feeItemForm.mandatory} onChange={e => setFeeItemForm(f => ({ ...f, mandatory: e.target.checked }))} /> {t('finance:financePage.feeItems.mandatory')}
              </label>
              <button className="btn-sm" onClick={addFeeItem}><i className="ti ti-plus"></i> {t('finance:financePage.feeItems.add')}</button>
            </div>
          </div>

          <div className="fin-section">
            <div className="fin-section-title">{t('finance:financePage.feePlan.title')}</div>
            <div className="fin-form-row" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('finance:financePage.feePlan.count')}</label>
              <input type="number" min="1" max="24" className="select-sm" style={{ width: 70 }} value={planForm.installmentCount} onChange={e => setInstallmentCount(e.target.value)} />
            </div>
            <table className="data-table" style={{ marginBottom: 10 }}>
              <thead><tr><th>#</th><th>{t('finance:financePage.feePlan.dueDate')}</th><th>{t('finance:financePage.feePlan.percentage')}</th></tr></thead>
              <tbody>
                {planForm.installments.map(row => (
                  <tr key={row.installmentNo}>
                    <td>{installmentLabel(t, row.installmentNo)}</td>
                    <td><input type="date" className="select-sm" value={row.dueDate || ''} onChange={e => updateInstallmentDef(row.installmentNo, 'dueDate', e.target.value)} /></td>
                    <td><input type="number" min="0" max="100" className="select-sm" style={{ width: 70 }} placeholder="%" value={row.percentage ?? ''} onChange={e => updateInstallmentDef(row.installmentNo, 'percentage', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="fin-form-row">
              <button className="btn-sm" onClick={savePlan}><i className="ti ti-check"></i> {t('finance:financePage.feePlan.save')}</button>
              <span className="field-hint">{t('finance:financePage.feePlan.hint')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
