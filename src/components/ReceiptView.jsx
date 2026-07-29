import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchReceipt } from '../api.js';
import { initials, installmentLabel } from '../utils.js';

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** A payment's official receipt — view/print/download, built entirely from
    GET /finance/payments/:id/receipt (real payment + student + ledger data, never mock). Portals
    to document.body (outside #app-wrapper) and toggles `body.receipt-open`, which the print rules
    in style.css use to hide the rest of the app and print only this document — see there for why
    a plain @media print scoped to this component's own DOM isn't enough (the surrounding modal
    system clips/scrolls its content, which would crop a tall receipt when printed). */
export default function ReceiptView({ paymentId, onClose }) {
  const { t } = useTranslation(['finance', 'common']);
  const { branding, logoUrl } = useAppData();
  const { toast } = useToast();
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    document.body.classList.add('receipt-open');
    return () => document.body.classList.remove('receipt-open');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReceipt(null);
    setError(null);
    fetchReceipt(paymentId)
      .then(r => { if (!cancelled) setReceipt(r); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [paymentId]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleDownload() {
    if (window.UNISCHEDULER_PRINT_TO_PDF) {
      setDownloading(true);
      try {
        const res = await window.UNISCHEDULER_PRINT_TO_PDF();
        if (!res.canceled) toast(t('finance:financePage.receipt.pdfSaved'));
      } catch {
        toast(t('finance:financePage.receipt.pdfFailed'), 'error');
      } finally {
        setDownloading(false);
      }
    } else {
      window.print();
    }
  }

  const money = (n) => `${Number(n || 0).toLocaleString()}${receipt?.currency ? ' ' + receipt.currency : ''}`;
  const voided = receipt?.status === 'reversed';

  // A row whose value is empty/null is omitted entirely rather than shown as an em-dash — e.g.
  // Program/Department when a student has no specialization or department on file yet, or
  // Reference when a cash payment was recorded without one.
  function Row({ label, value }) {
    if (value === null || value === undefined || value === '') return null;
    return <div><span>{label}</span><strong>{value}</strong></div>;
  }

  return createPortal(
    <div className="receipt-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="receipt-toolbar no-print">
        <span className="receipt-toolbar-title">{t('finance:financePage.receipt.title')}</span>
        <div className="receipt-toolbar-actions">
          <button className="btn-sm" onClick={() => window.print()} disabled={!receipt}>
            <i className="ti ti-printer" aria-hidden="true"></i> {t('finance:financePage.receipt.print')}
          </button>
          <button className={'btn-sm' + (downloading ? ' btn-loading' : '')} onClick={handleDownload} disabled={!receipt || downloading}>
            {downloading ? <span className="spinner"></span> : <><i className="ti ti-download" aria-hidden="true"></i> {t('finance:financePage.receipt.downloadPdf')}</>}
          </button>
          <button className="icon-btn" aria-label={t('common:actions.close')} onClick={onClose}><i className="ti ti-x" aria-hidden="true"></i></button>
        </div>
      </div>

      {!receipt && !error && <div className="receipt-doc"><div className="empty-state">{t('common:actions.loading')}</div></div>}
      {error && <div className="receipt-doc"><div className="empty-state">{error}</div></div>}

      {receipt && (
        <div className="receipt-doc" id="receipt-print-root">
          {voided && (
            <div className="receipt-void-banner">
              {t('finance:financePage.receipt.voidedBanner', { date: fmtDateTime(receipt.voidedAt), name: receipt.voidedByName || '—' })}
            </div>
          )}
          {receipt.reconstructed && (
            <div className="receipt-reconstructed-note no-print">{t('finance:financePage.receipt.reconstructedNote')}</div>
          )}

          <div className="receipt-header">
            <div className="receipt-org">
              <div className="receipt-org-logo" style={{ background: logoUrl ? 'transparent' : (branding.brandColor || '#4B7FE8') }}>
                {logoUrl ? <img src={logoUrl} alt="" /> : (initials(branding.orgName) || <i className="ti ti-school" aria-hidden="true"></i>)}
              </div>
              <div>
                <div className="receipt-org-name">{branding.orgName || 'UniScheduler'}</div>
                <div className="receipt-org-sub">{t('finance:financePage.receipt.officialReceipt')}</div>
              </div>
            </div>
            <div className="receipt-meta">
              <div><span>{t('finance:financePage.receipt.receiptNo')}</span><strong>{receipt.receiptNo}</strong></div>
              <div><span>{t('finance:financePage.receipt.date')}</span><strong>{fmtDateTime(receipt.paidAt)}</strong></div>
              {receipt.invoiceNo && <div><span>{t('finance:financePage.receipt.invoiceNo')}</span><strong>{receipt.invoiceNo}</strong></div>}
              <div><span>{t('finance:financePage.receipt.status')}</span><strong>{t(voided ? 'finance:financePage.receipt.statusReversed' : 'finance:financePage.receipt.statusCompleted')}</strong></div>
            </div>
          </div>

          <div className="receipt-section">
            <h4>{t('finance:financePage.receipt.studentInfo')}</h4>
            <div className="receipt-grid">
              <div><span>{t('finance:financePage.receipt.studentName')}</span><strong>{receipt.student?.name || '—'}</strong></div>
              <div><span>{t('finance:financePage.receipt.studentId')}</span><strong>{receipt.student?.idNumber || '—'}</strong></div>
              <Row label={t('finance:financePage.receipt.program')} value={receipt.program} />
              <Row label={t('finance:financePage.receipt.department')} value={receipt.department} />
              <div><span>{t('finance:financePage.receipt.term')}</span><strong>{receipt.term?.name || '—'}</strong></div>
              <div><span>{t('finance:financePage.receipt.academicYear')}</span><strong>{receipt.term?.academicYear || '—'}</strong></div>
            </div>
          </div>

          <div className="receipt-section">
            <h4>{t('finance:financePage.receipt.paymentDetails')}</h4>
            <div className="receipt-grid">
              <div><span>{t('finance:financePage.receipt.method')}</span><strong>{t(`finance:financePage.methods.${receipt.method || 'cash'}`)}</strong></div>
              <Row label={t('finance:financePage.receipt.reference')} value={receipt.reference} />
              <div><span>{t('finance:financePage.receipt.previousBalance')}</span><strong>{receipt.previousBalance != null ? money(receipt.previousBalance) : '—'}</strong></div>
              {receipt.previousCredit > 0 && (
                <div><span>{t('finance:financePage.receipt.previousCredit')}</span><strong>{money(receipt.previousCredit)}</strong></div>
              )}
              <div><span>{t('finance:financePage.receipt.amountPaid')}</span><strong className="receipt-amount">{money(receipt.amount)}</strong></div>
              <div><span>{t('finance:financePage.receipt.remainingBalance')}</span><strong>{receipt.remainingBalance != null ? money(receipt.remainingBalance) : '—'}</strong></div>
              {receipt.remainingCredit > 0 && (
                <div><span>{t('finance:financePage.receipt.remainingCredit')}</span><strong className="receipt-amount">{money(receipt.remainingCredit)}</strong></div>
              )}
            </div>
          </div>

          {receipt.allocation?.length > 0 && (
            <div className="receipt-section">
              <h4>{t('finance:financePage.receipt.allocation')}</h4>
              <table className="data-table">
                <thead><tr>
                  <th>{t('finance:financePage.receipt.allocationTerm')}</th>
                  <th>{t('finance:financePage.receipt.allocationInstallment')}</th>
                  <th>{t('finance:financePage.receipt.allocationAmount')}</th>
                </tr></thead>
                <tbody>
                  {receipt.allocation.map((a, i) => (
                    <tr key={i}>
                      <td>{a.termName || '—'}</td>
                      <td>{installmentLabel(t, a.installmentNo)}</td>
                      <td>{money(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="receipt-footer">
            <div>
              <div className="receipt-signature-line"></div>
              <div>{t('finance:financePage.receipt.receivedBy')}: {receipt.officer?.name || '—'}</div>
            </div>
            <div className="receipt-footer-note">{t('finance:financePage.receipt.immutableNote')}</div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
