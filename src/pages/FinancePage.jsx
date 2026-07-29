import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { can } from '../permissions.js';
import {
  fetchFinanceSettings, saveFinanceSettings, fetchFinanceStudents,
  fetchStudentStatement, recordPayment, voidPayment,
} from '../api.js';

const METHODS = ['cash', 'bank', 'card', 'mobile', 'other'];

export default function FinancePage() {
  const { t } = useTranslation(['finance', 'common']);
  const { currentUser } = useAppData();
  const { activeSection } = useNavigation();
  const { confirmAction } = useModal();
  const { toast } = useToast();
  const { run: runPay, loading: paying } = useAsyncAction();
  const canWrite = can(currentUser.role, 'finance', 'write');

  const [settings, setSettings] = useState({ perCreditFee: 0, currency: '' });
  const [rate, setRate] = useState('');
  const [currency, setCurrency] = useState('');
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // full statement
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');

  const money = (n) => `${Number(n).toLocaleString()}${settings.currency ? ' ' + settings.currency : ''}`;

  async function load() {
    const [s, list] = await Promise.all([fetchFinanceSettings(), fetchFinanceStudents()]);
    setSettings(s); setRate(String(s.perCreditFee ?? '')); setCurrency(s.currency ?? '');
    setStudents(list.students);
  }
  useEffect(() => {
    if (!can(currentUser.role, 'finance', 'read')) return;
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.role, activeSection]);

  async function openStudent(id) {
    try { setSelected(await fetchStudentStatement(id)); setAmount(''); setReference(''); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function saveRate() {
    try {
      const s = await saveFinanceSettings({ perCreditFee: Number(rate) || 0, currency: currency.trim() });
      setSettings(s);
      toast(t('finance:financePage.rateSaved'));
      await load();
      if (selected) openStudent(selected.student.id);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function submitPayment() {
    const amt = Number(amount);
    if (!(amt > 0)) return;
    try {
      const res = await runPay(recordPayment(selected.student.id, { amount: amt, method, reference: reference.trim() || undefined }));
      setSelected(s => ({ ...s, ...res.statement }));
      setAmount(''); setReference('');
      toast(t('finance:financePage.paymentRecorded', { receipt: res.payment.receiptNo }));
      await load();
    } catch (err) { toast(err.message, 'error'); }
  }

  function doVoid(p) {
    confirmAction(t('finance:financePage.confirmVoid', { receipt: p.receiptNo }), async () => {
      try {
        await voidPayment(p.id);
        toast(t('finance:financePage.voided'));
        await openStudent(selected.student.id);
        await load();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  const q = search.trim().toLowerCase();
  const shown = q ? students.filter(s => (s.name || '').toLowerCase().includes(q) || (s.idNumber || '').toLowerCase().includes(q)) : students;

  return (
    <Section name="finance">
      <div className="topbar">
        <i className="ti ti-cash" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('finance:financePage.title')}</h2>
        {canWrite && (
          <div className="topbar-actions">
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('finance:financePage.rateLabel')}</label>
            <input type="number" min="0" className="select-sm" style={{ width: 90 }} value={rate} onChange={e => setRate(e.target.value)} />
            <input type="text" className="select-sm" style={{ width: 70 }} placeholder={t('finance:financePage.currencyLabel')} value={currency} onChange={e => setCurrency(e.target.value)} />
            <button className="btn-sm" onClick={saveRate}><i className="ti ti-check"></i> {t('finance:financePage.save')}</button>
          </div>
        )}
      </div>
      <div id="content" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="panel">
          <div style={{ padding: 10 }}>
            <input type="text" className="select-sm" style={{ width: '100%' }} placeholder={t('finance:financePage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <table className="data-table">
            <thead><tr>
              <th>{t('finance:financePage.columns.student')}</th>
              <th>{t('finance:financePage.columns.charged')}</th>
              <th>{t('finance:financePage.columns.paid')}</th>
              <th>{t('finance:financePage.columns.balance')}</th>
              <th>{t('finance:financePage.columns.status')}</th>
            </tr></thead>
            <tbody>
              {shown.map(s => (
                <tr key={s.studentId} onClick={() => openStudent(s.studentId)} style={{ cursor: 'pointer', background: selected?.student?.id === s.studentId ? 'var(--surface-2, rgba(0,0,0,0.04))' : undefined }}>
                  <td>{s.name}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.idNumber}</div></td>
                  <td>{money(s.totalCharged)}</td>
                  <td>{money(s.totalPaid)}</td>
                  <td>{money(s.balance)}</td>
                  <td>{s.hasHold
                    ? <span className="pill pill-red">{t('finance:financePage.hold')}</span>
                    : <span className="pill pill-green">{t('finance:financePage.clear')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel" style={{ padding: 16 }}>
          {!selected ? (
            <div className="empty-state">{t('finance:financePage.selectStudent')}</div>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>{selected.student.name} · {t('finance:financePage.statementTitle')}</h3>
              <table className="data-table" style={{ marginBottom: 12 }}>
                <thead><tr><th>{t('finance:financePage.course')}</th><th>{t('finance:financePage.credits')}</th><th>{t('finance:financePage.fee')}</th></tr></thead>
                <tbody>
                  {selected.courses.map(c => (
                    <tr key={c.id}><td>{c.code} — {c.name}</td><td>{c.credits}</td><td>{money(c.fee)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:financePage.totalCharged')}</div><strong>{money(selected.totalCharged)}</strong></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:financePage.totalPaid')}</div><strong>{money(selected.totalPaid)}</strong></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('finance:financePage.balance')}</div>
                  <strong style={{ color: selected.hasHold ? 'var(--danger, #d33)' : 'inherit' }}>{money(selected.balance)}</strong></div>
              </div>

              {canWrite && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                  <input type="number" min="0" className="select-sm" style={{ width: 110 }} placeholder={t('finance:financePage.amount')} value={amount} onChange={e => setAmount(e.target.value)} />
                  <select className="select-sm" value={method} onChange={e => setMethod(e.target.value)}>
                    {METHODS.map(m => <option key={m} value={m}>{t(`finance:financePage.methods.${m}`)}</option>)}
                  </select>
                  <input type="text" className="select-sm" style={{ width: 130 }} placeholder={t('finance:financePage.reference')} value={reference} onChange={e => setReference(e.target.value)} />
                  <button className={'btn-primary' + (paying ? ' btn-loading' : '')} disabled={paying} onClick={submitPayment}>
                    {paying ? <span className="spinner"></span> : <><i className="ti ti-plus"></i> {t('finance:financePage.record')}</>}
                  </button>
                </div>
              )}

              <h4 style={{ margin: '0 0 6px' }}>{t('finance:financePage.payments')}</h4>
              {selected.payments.length === 0 ? (
                <div className="empty-state">{t('finance:financePage.noPayments')}</div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>{t('finance:financePage.receiptNo')}</th><th>{t('finance:financePage.amount')}</th><th>{t('finance:financePage.method')}</th><th>{t('finance:financePage.date')}</th>{canWrite && <th></th>}</tr></thead>
                  <tbody>
                    {selected.payments.map(p => (
                      <tr key={p.id}>
                        <td><code>{p.receiptNo}</code></td>
                        <td>{money(p.amount)}</td>
                        <td>{t(`finance:financePage.methods.${p.method || 'cash'}`)}</td>
                        <td>{(p.paidAt || '').split(' ')[0]}</td>
                        {canWrite && <td><button className="icon-btn danger" aria-label={t('finance:financePage.voidAria', { receipt: p.receiptNo })} onClick={() => doVoid(p)}><i className="ti ti-trash" aria-hidden="true"></i></button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </Section>
  );
}
