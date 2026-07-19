import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { exportAccountCredentialsCsv, exportAccountCredentialsTxt } from '../../accountExport.js';

/** Port of showAccountCreatedModal() — the one-time temp password display for single and bulk
    account creation, plus any rows that were skipped. */
export default function AccountCredentials({ prefill }) {
  const { t } = useTranslation(['admin', 'admissions', 'common']);
  const { accounts, errors, emailStatus } = prefill;
  const { closeModal } = useModal();
  const { toast } = useToast();
  const { branding } = useAppData();

  return (
    <>
      <div id="modal-body">
        {emailStatus && (
          <div className={'alert-item ' + (emailStatus.sent ? 'alert-info' : 'alert-warn')} style={{ marginBottom: 12 }}>
            <i className={'ti ' + (emailStatus.sent ? 'ti-mail-check' : 'ti-mail-exclamation')} style={{ fontSize: 18 }}></i>
            <div style={{ flex: 1 }}>
              <div className="alert-desc">
                {emailStatus.sent
                  ? t('admissions:credentialsBanner.emailSent')
                  : t('admissions:credentialsBanner.emailFailed', { reason: emailStatus.reason })}
              </div>
            </div>
          </div>
        )}
        {accounts.length ? (
          <>
            <div className="field-hint" style={{ marginBottom: 10 }}>{t('admin:accountCredentials.hint')}</div>
            <table className="data-table">
              <thead><tr><th>{t('admin:accountCredentials.table.idNumber')}</th><th>{t('common:fields.name')}</th><th>{t('common:fields.email')}</th><th>{t('common:fields.role')}</th><th>{t('admin:accountCredentials.table.tempPassword')}</th></tr></thead>
              <tbody>
                {accounts.map((a, i) => (
                  <tr key={i}><td><code>{a.idNumber || t('common:notApplicable')}</code></td><td>{a.name}</td><td>{a.email}</td><td>{a.role}</td><td><code>{a.tempPassword}</code></td></tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <div className="field-hint">{t('admin:accountCredentials.none')}</div>}
        {errors && errors.length > 0 && (
          <>
            <div className="field-hint" style={{ margin: '14px 0 6px', color: 'var(--danger)' }}>{t('admin:accountCredentials.skippedCount', { count: errors.length })}</div>
            <div className="roster-list">
              {errors.map((e, i) => (
                <div className="roster-row" key={i}><span>{t('admin:accountCredentials.rowLabel', { row: e.row })}</span><span style={{ color: 'var(--danger)' }}>{e.error}</span></div>
              ))}
            </div>
          </>
        )}
      </div>
      <div id="modal-footer" className="modal-footer">
        {accounts.length > 0 && (
          <>
            <button className="btn-sm" onClick={() => { exportAccountCredentialsCsv(accounts); toast(t('admin:accountCredentials.toast.exported')); }}><i className="ti ti-download"></i> {t('admin:accountCredentials.exportCsv')}</button>
            <button className="btn-sm" onClick={() => { exportAccountCredentialsTxt(accounts, branding.orgName || 'UniScheduler'); toast(t('admin:accountCredentials.toast.exported')); }}><i className="ti ti-file-text"></i> {t('admin:accountCredentials.exportReadable')}</button>
          </>
        )}
        <button className="btn-primary" onClick={closeModal}>{t('admin:accountCredentials.done')}</button>
      </div>
    </>
  );
}
