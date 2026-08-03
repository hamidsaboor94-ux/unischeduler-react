import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchGraduationEligible, confirmGraduation, downloadGraduationCertificate } from '../api.js';

/** Registrar/Admin worklist for the terminal step of the academic lifecycle: a student reaches
    semesterStatus='Graduation Eligible' (academicProgression.js), then a human here confirms the
    actual degree conferral. Confirming is deliberately behind an explicit confirm dialog — it's
    a hard-to-undo action (studentStatus -> 'Graduated', a certificate is issued) — and the server
    re-checks eligibility + financial clearance itself, so this page is a worklist, not the source
    of truth for whether a confirm will succeed. */
export default function GraduationPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { activeSection } = useNavigation();
  const { confirmAction } = useModal();
  const { toast } = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // studentId -> the just-conferred record, so a "Download Certificate" action appears in place
  // of the row it graduated (which the next /eligible refresh naturally omits — it's no longer
  // Graduation Eligible, it's Graduated).
  const [confirmed, setConfirmed] = useState({});

  async function refresh() {
    setLoading(true);
    try {
      setRows(await fetchGraduationEligible());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (activeSection === 'graduation') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  async function doConfirm(row) {
    setBusyId(row.studentId);
    try {
      const record = await confirmGraduation(row.studentId);
      setConfirmed(c => ({ ...c, [row.studentId]: record }));
      toast(t('admin:graduationPage.conferredToast', { name: row.name, degree: record.degreeAwarded }));
      setRows(rs => rs.filter(r => r.studentId !== row.studentId));
    } catch (err) {
      if (err.code === 'FINANCE_HOLD') {
        toast(t('admin:graduationPage.financeHoldError', { amount: err.outstandingBalance }), 'error');
      } else {
        toast(err.message || t('admin:graduationPage.genericError'), 'error');
      }
    } finally {
      setBusyId(null);
    }
  }

  function handleConfirmClick(row) {
    confirmAction(
      t('admin:graduationPage.confirmDialog', { name: row.name }),
      () => doConfirm(row),
      t('admin:graduationPage.confirmLabel')
    );
  }

  return (
    <Section name="graduation">
      <div className="topbar">
        <i className="ti ti-certificate" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('admin:graduationPage.title')}</h2>
      </div>
      <div id="content">
        <p className="field-hint" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('admin:graduationPage.hint')}
        </p>
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('admin:graduationPage.table.name')}</th>
                <th>{t('admin:graduationPage.table.idNumber')}</th>
                <th>{t('admin:graduationPage.table.department')}</th>
                <th>{t('admin:graduationPage.table.program')}</th>
                <th>{t('admin:graduationPage.table.degree')}</th>
                <th>{t('admin:graduationPage.table.finance')}</th>
                <th>{t('admin:graduationPage.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="field-hint" style={{ padding: 14 }}>{t('admin:graduationPage.empty')}</td></tr>
              ) : rows.map(row => {
                const busy = busyId === row.studentId;
                const record = confirmed[row.studentId];
                return (
                  <tr key={row.studentId}>
                    <td>{row.name}</td>
                    <td>{row.idNumber || '—'}</td>
                    <td>{row.departmentName || '—'}</td>
                    <td>{row.programName || '—'}</td>
                    <td>{row.degreeAwarded || '—'}</td>
                    <td>
                      {row.financiallyCleared ? (
                        <span className="pill pill-green">{t('admin:graduationPage.financiallyCleared')}</span>
                      ) : (
                        <span className="pill pill-red" title={row.blockedReason || ''}>
                          {t('admin:graduationPage.financeBlocked', { amount: row.outstandingBalance })}
                        </span>
                      )}
                    </td>
                    <td>
                      {record ? (
                        <button className="btn-sm" onClick={() => downloadGraduationCertificate(row.studentId, `certificate-${row.idNumber || row.studentId}.pdf`)}>
                          <i className="ti ti-download"></i> {t('admin:graduationPage.downloadCertificate')}
                        </button>
                      ) : (
                        <button
                          className={'btn-primary' + (busy ? ' btn-loading' : '')}
                          disabled={busy || !row.financiallyCleared}
                          onClick={() => handleConfirmClick(row)}
                        >
                          {busy ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('admin:graduationPage.confirmButton')}</>}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
