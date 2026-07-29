import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { can } from '../permissions.js';
import { summarizeFinanceWorklist, findPreviousTermId } from '../utils.js';
import ReceiptView from '../components/ReceiptView.jsx';
import FeeConfigDrawer from '../components/FeeConfigDrawer.jsx';
import FinanceStatCards from '../components/finance/FinanceStatCards.jsx';
import FinanceBillingStatusPanel from '../components/finance/FinanceBillingStatusPanel.jsx';
import FinanceQuickInsights from '../components/finance/FinanceQuickInsights.jsx';
import FinanceStudentDetail from '../components/finance/FinanceStudentDetail.jsx';
import {
  fetchFinanceStudents, fetchStudentStatement, recordPayment, voidPayment,
  fetchTermFeeConfig, saveTermFeeConfig, createFeeItem, updateFeeItem, deleteFeeItem,
  createFeeRule, updateFeeRule, deleteFeeRule,
  saveStudentType, deleteStudentType,
  fetchFeePlan, saveFeePlan, generateCharges,
} from '../api.js';

const emptyFeeRuleForm = { scope: 'university', scopeId: '', studentTypeId: '', feePerCredit: '', effectiveDate: '' };
const emptyFeeItemForm = { name: '', amount: '', scope: 'university', scopeId: '', studentTypeId: '', feeType: 'other', mandatory: true, effectiveDate: '' };

export default function FinancePage() {
  const { t } = useTranslation(['finance', 'common']);
  const { currentUser, terms, activeTermId, colleges, departments, programs, studentTypes, afterMutate } = useAppData();
  const { activeSection, sectionFocus } = useNavigation();
  const { confirmAction } = useModal();
  const { toast } = useToast();
  const { run: runPay, loading: paying } = useAsyncAction();
  const { run: runGenerate, loading: generating } = useAsyncAction();
  const canWrite = can(currentUser.role, 'finance', 'write');
  // Fee Configuration (rate, fee items, fee rules, installment plan) sets billing policy, not a
  // day-to-day billing operation — restricted to admin even though the Bursar has 'finance' write
  // access to everything else (generate charges, payments, aid). Enforced server-side too (see
  // routes/finance.js) — this only controls what the UI offers.
  const isAdmin = currentUser.role === 'admin';

  const [termId, setTermId] = useState(activeTermId || null);
  const [termConfig, setTermConfig] = useState(null); // { feePerCredit, currency, feeItems, feePlan }
  const [rate, setRate] = useState('');
  const [currency, setCurrency] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [feeItemForm, setFeeItemForm] = useState(emptyFeeItemForm);
  const [ruleForm, setRuleForm] = useState(emptyFeeRuleForm);
  const [newTypeName, setNewTypeName] = useState('');
  const [planForm, setPlanForm] = useState({ installmentCount: 1, installments: [] });

  const [students, setStudents] = useState([]);
  const [previousSummary, setPreviousSummary] = useState(null); // {totalCharged, totalPaid, balance, overdueCount} for the prior term, or null
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null); // full statement
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [receiptId, setReceiptId] = useState(null);

  const money = (n) => `${Number(n || 0).toLocaleString()}${(selected?.currency || termConfig?.currency) ? ' ' + (selected?.currency || termConfig?.currency) : ''}`;

  useEffect(() => { if (!termId && activeTermId) setTermId(activeTermId); }, [activeTermId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadWorklist() {
    const list = await fetchFinanceStudents(termId);
    setStudents(list.students);
  }
  /** The stat cards' "vs last term" deltas need the same aggregate for the immediately preceding
   *  term — reuses the existing worklist endpoint rather than a new one (there's only ever one
   *  extra term to fetch here). Left null (deltas hidden) when there's no prior term. */
  async function loadPreviousSummary() {
    const previousTermId = findPreviousTermId(terms, termId);
    if (!previousTermId) { setPreviousSummary(null); return; }
    const list = await fetchFinanceStudents(previousTermId);
    setPreviousSummary(summarizeFinanceWorklist(list.students));
  }
  async function loadTermConfig() {
    if (!termId) { setTermConfig(null); return; }
    const [cfg, plan] = await Promise.all([fetchTermFeeConfig(termId), fetchFeePlan(termId)]);
    setTermConfig(cfg);
    setRate(String(cfg.feePerCredit ?? '')); setCurrency(cfg.currency ?? '');
    setPlanForm(plan || { installmentCount: 1, installments: [] });
  }
  useEffect(() => {
    if (!can(currentUser.role, 'finance', 'read')) return;
    loadWorklist().catch(() => {});
    loadPreviousSummary().catch(() => {});
    loadTermConfig().catch(() => {});
    if (selected) openStudent(selected.student.id).catch(() => {});
    // Deliberately NOT depending on `terms`: every page stays mounted (see CLAUDE.md), and
    // AppDataContext.reload() — triggered by afterMutate() calls anywhere in the app — hands out
    // a new `terms` array reference on every unrelated mutation. Depending on it here would
    // refetch this whole page's finance data any time something elsewhere in the app saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.role, activeSection, termId]);

  // The Students page's "View Finance" quick action navigates here with a studentId focus —
  // openStudent() only needs the id (it fetches the statement directly), not a row from the
  // worklist, so this works regardless of whether that student is in the currently loaded list.
  useEffect(() => {
    if (sectionFocus?.section === 'finance' && sectionFocus.studentId != null) {
      openStudent(Number(sectionFocus.studentId)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionFocus]);

  async function openStudent(id) {
    try {
      setSelected(await fetchStudentStatement(id, termId));
      setAmount(''); setReference('');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function saveRate() {
    try {
      const cfg = await saveTermFeeConfig(termId, { feePerCredit: Number(rate) || 0, currency: currency.trim() });
      setTermConfig(c => ({ ...c, ...cfg }));
      toast(t('finance:financePage.rateSaved'));
      await Promise.all([loadWorklist(), selected ? openStudent(selected.student.id) : Promise.resolve()]);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function addFeeItem() {
    const amt = Number(feeItemForm.amount);
    if (!feeItemForm.name.trim() || !(amt > 0)) return;
    if (feeItemForm.scope !== 'university' && !feeItemForm.scopeId) return;
    try {
      const item = await createFeeItem(termId, {
        name: feeItemForm.name.trim(), amount: amt, scope: feeItemForm.scope,
        scopeId: feeItemForm.scopeId || undefined, studentTypeId: feeItemForm.studentTypeId || undefined,
        feeType: feeItemForm.feeType, mandatory: feeItemForm.mandatory, effectiveDate: feeItemForm.effectiveDate || undefined,
      });
      setTermConfig(c => ({ ...c, feeItems: [...(c.feeItems || []), item] }));
      setFeeItemForm(emptyFeeItemForm);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function removeFeeItem(id) {
    try {
      await deleteFeeItem(id);
      setTermConfig(c => ({ ...c, feeItems: (c.feeItems || []).filter(f => f.id !== id) }));
    } catch (err) { toast(err.message, 'error'); }
  }
  async function toggleFeeItemActive(item) {
    try {
      const updated = await updateFeeItem(item.id, { ...item, isActive: !item.isActive });
      setTermConfig(c => ({ ...c, feeItems: (c.feeItems || []).map(f => f.id === item.id ? updated : f) }));
    } catch (err) { toast(err.message, 'error'); }
  }

  async function addFeeRule() {
    const amt = Number(ruleForm.feePerCredit);
    if (!(amt >= 0)) return;
    if (ruleForm.scope !== 'university' && !ruleForm.scopeId) return;
    try {
      const rule = await createFeeRule(termId, {
        scope: ruleForm.scope, scopeId: ruleForm.scopeId || undefined, studentTypeId: ruleForm.studentTypeId || undefined,
        feePerCredit: amt, effectiveDate: ruleForm.effectiveDate || undefined,
      });
      setTermConfig(c => ({ ...c, feeRules: [...(c.feeRules || []), rule] }));
      setRuleForm(emptyFeeRuleForm);
      toast(t('finance:financePage.feeRules.added'));
    } catch (err) { toast(err.message, 'error'); }
  }
  async function toggleFeeRuleActive(rule) {
    try {
      const updated = await updateFeeRule(rule.id, { isActive: !rule.isActive });
      setTermConfig(c => ({ ...c, feeRules: (c.feeRules || []).map(r => r.id === rule.id ? { ...r, ...updated } : r) }));
    } catch (err) { toast(err.message, 'error'); }
  }
  async function removeFeeRule(id) {
    try {
      await deleteFeeRule(id);
      setTermConfig(c => ({ ...c, feeRules: (c.feeRules || []).filter(r => r.id !== id) }));
    } catch (err) { toast(err.message, 'error'); }
  }

  async function addStudentType() {
    const name = newTypeName.trim();
    if (!name) return;
    try {
      await afterMutate(saveStudentType({ name, isActive: true, sortOrder: studentTypes.length }), t('finance:financePage.studentTypes.added'));
      setNewTypeName('');
    } catch (err) { toast(err.message, 'error'); }
  }
  async function toggleStudentTypeActive(st) {
    try { await afterMutate(saveStudentType({ name: st.name, isActive: !st.isActive, sortOrder: st.sortOrder }, st.id)); }
    catch (err) { toast(err.message, 'error'); }
  }
  function removeStudentType(st) {
    confirmAction(t('finance:financePage.studentTypes.confirmDelete', { name: st.name }), async () => {
      try { await afterMutate(deleteStudentType(st.id), t('finance:financePage.studentTypes.removed')); }
      catch (err) { toast(err.message, 'error'); }
    });
  }

  function setInstallmentCount(n) {
    const count = Math.max(1, Math.min(24, Number(n) || 1));
    setPlanForm(p => {
      const installments = Array.from({ length: count }, (_, i) => p.installments.find(x => x.installmentNo === i + 1) || { installmentNo: i + 1, dueDate: '', percentage: '' });
      return { installmentCount: count, installments };
    });
  }
  function updateInstallmentDef(no, field, value) {
    setPlanForm(p => ({ ...p, installments: p.installments.map(x => x.installmentNo === no ? { ...x, [field]: value } : x) }));
  }
  async function savePlan() {
    try {
      const plan = await saveFeePlan(termId, planForm);
      setPlanForm(plan);
      toast(t('finance:financePage.planSaved'));
    } catch (err) { toast(err.message, 'error'); }
  }

  async function doGenerateCharges() {
    try {
      const res = await runGenerate(generateCharges(termId));
      toast(t('finance:financePage.chargesGenerated', { count: res.studentsCharged, total: money(res.totalAmount) }));
      await loadWorklist();
      if (selected) await openStudent(selected.student.id);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function submitPayment() {
    const amt = Number(amount);
    if (!(amt > 0)) return;
    try {
      const res = await runPay(recordPayment(selected.student.id, { amount: amt, method, reference: reference.trim() || undefined, termId }));
      setSelected(s => ({ ...s, ...res.statement }));
      setAmount(''); setReference('');
      toast(t('finance:financePage.paymentRecorded', { receipt: res.payment.receiptNo }));
      await loadWorklist();
    } catch (err) { toast(err.message, 'error'); }
  }

  function doVoid(p) {
    confirmAction(t('finance:financePage.confirmVoid', { receipt: p.receiptNo }), async () => {
      try {
        await voidPayment(p.id);
        toast(t('finance:financePage.voided'));
        await openStudent(selected.student.id);
        await loadWorklist();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // ---- Derived view state (client-side only — every figure below is summed from the same
  // `students` worklist the table renders, itself straight from GET /finance/students). ----
  const summary = summarizeFinanceWorklist(students);
  const selectedTermName = terms.find(term => term.id === termId)?.name || '';

  return (
    <Section name="finance">
      <div className="topbar">
        <i className="ti ti-cash" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('finance:financePage.title')}</h2>
        <div className="topbar-actions no-print">
          {canWrite && termId && (
            <button className={'btn-sm' + (generating ? ' btn-loading' : '')} disabled={generating} onClick={doGenerateCharges}>
              {generating ? <span className="spinner"></span> : <><i className="ti ti-refresh"></i> {t('finance:financePage.generateCharges')}</>}
            </button>
          )}
          {isAdmin && termId && (
            <button className="btn-sm" onClick={() => setConfigOpen(true)}>
              <i className="ti ti-settings"></i> {t('finance:financePage.termConfig.button')}
            </button>
          )}
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('finance:financePage.termLabel')}</label>
          <select className="select-sm" value={termId || ''} onChange={e => { setSelected(null); setTermId(Number(e.target.value) || null); }}>
            <option value="">{t('finance:financePage.selectTerm')}</option>
            {terms.map(term => <option key={term.id} value={term.id}>{term.name}</option>)}
          </select>
        </div>
      </div>

      <div id="content">
        <div className="fin-subtitle no-print">{t('finance:financePage.subtitle')}</div>

        <FinanceStatCards summary={summary} previousSummary={previousSummary} money={money} />

        <FinanceQuickInsights students={students} />

        <FinanceBillingStatusPanel
          students={students}
          search={search} setSearch={setSearch}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          money={money}
          selectedStudentId={selected?.student?.id ?? null}
          onSelectStudent={openStudent}
        />
      </div>

      {configOpen && (
        <FeeConfigDrawer
          onClose={() => setConfigOpen(false)}
          termName={selectedTermName}
          money={money}
          rate={rate} setRate={setRate} currency={currency} setCurrency={setCurrency} saveRate={saveRate}
          studentTypes={studentTypes} newTypeName={newTypeName} setNewTypeName={setNewTypeName}
          addStudentType={addStudentType} toggleStudentTypeActive={toggleStudentTypeActive} removeStudentType={removeStudentType}
          termConfig={termConfig} ruleForm={ruleForm} setRuleForm={setRuleForm}
          addFeeRule={addFeeRule} toggleFeeRuleActive={toggleFeeRuleActive} removeFeeRule={removeFeeRule}
          feeItemForm={feeItemForm} setFeeItemForm={setFeeItemForm}
          addFeeItem={addFeeItem} removeFeeItem={removeFeeItem} toggleFeeItemActive={toggleFeeItemActive}
          planForm={planForm} setInstallmentCount={setInstallmentCount} updateInstallmentDef={updateInstallmentDef} savePlan={savePlan}
          colleges={colleges} departments={departments} programs={programs}
        />
      )}
      {selected && (
        <FinanceStudentDetail
          onClose={() => setSelected(null)}
          selected={selected}
          termId={termId}
          canWrite={canWrite}
          money={money}
          amount={amount} setAmount={setAmount}
          method={method} setMethod={setMethod}
          reference={reference} setReference={setReference}
          submitPayment={submitPayment} paying={paying}
          doVoid={doVoid}
          onOpenReceipt={setReceiptId}
        />
      )}
      {receiptId && <ReceiptView paymentId={receiptId} onClose={() => setReceiptId(null)} />}
    </Section>
  );
}
