import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { exportAccountCredentialsCsv, exportAccountCredentialsTxt } from '../../accountExport.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';

export default function PdfImportResult({ prefill: result }) {
  const { t } = useTranslation(['timetable', 'common']);
  const { closeModal } = useModal();
  const { toast } = useToast();
  const { branding } = useAppData();
  const c = result.created;
  const conflictIssues = [...(result.conflicts?.critical || []), ...(result.conflicts?.warnings || [])];
  const conflictCount = conflictIssues.length;
  const accounts = result.facultyAccountsCreated || [];

  return (
    <>
      <div id="modal-body">
        <div className="pdf-import-summary">
          {t('timetable:pdfImportResult.summaryImported', { slots: c.slots, courses: c.courses, rooms: c.rooms })}
          {c.facultyAccounts > 0 && <><br />{t('timetable:pdfImportResult.facultyAccountsCreated', { count: c.facultyAccounts })}</>}
          {result.needsTeacherAssignment > 0 && <><br /><span style={{ color: 'var(--warning)' }}>{t('timetable:pdfImportResult.needsTeacherAssignment', { count: result.needsTeacherAssignment })}</span></>}
          {result.errors.length > 0 && <><br /><span style={{ color: 'var(--danger)' }}>{t('timetable:pdfImportResult.errorsSkipped', { count: result.errors.length })}</span></>}
          {result.skippedDuplicates?.length > 0 && <><br /><span style={{ color: 'var(--warning)' }}>{t('timetable:pdfImportResult.duplicatesSkipped', { count: result.skippedDuplicates.length })}</span></>}
          {conflictCount > 0 && <><br /><span style={{ color: 'var(--warning)' }}>{t('timetable:pdfImportResult.conflictsDetected', { count: conflictCount })}</span></>}
        </div>

        {result.errors.length > 0 && (
          <div className="roster-list">
            {result.errors.map((e, i) => (
              <div className="roster-row" key={i}><span>{t('timetable:pdfImportResult.rowLabel', { row: e.row })}</span><span style={{ color: 'var(--danger)' }}>{e.error}</span></div>
            ))}
          </div>
        )}

        {result.skippedDuplicates?.length > 0 && (
          <>
            <div className="pdf-import-group-title" style={{ marginTop: 14 }}>{t('timetable:pdfImportResult.skippedDuplicatesTitle')}</div>
            <div className="roster-list">
              {result.skippedDuplicates.map((d, i) => (
                <div className="roster-row" key={i}>
                  <span>{t('timetable:pdfImportResult.rowSummary', { row: d.row, courseName: d.courseName })}</span>
                  <span className="field-hint">{t('timetable:pdfImportResult.rowMeta', { sem: d.programSemester, section: d.section, day: d.day, time: d.time })}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {conflictCount > 0 && (
          <>
            <div className="pdf-import-group-title" style={{ marginTop: 14 }}>{t('timetable:pdfImportResult.conflictsListTitle')}</div>
            <div className="roster-list">
              {conflictIssues.map((issue, i) => (
                <div className="roster-row" key={i}>
                  <span style={{ color: 'var(--warning)' }}>{issue.title}</span>
                  <span className="field-hint">{issue.desc}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {accounts.length > 0 && (
          <>
            <div className="pdf-import-group-title" style={{ marginTop: 14 }}>{t('timetable:pdfImportResult.newCredentialsTitle')}</div>
            <div className="field-hint" style={{ marginBottom: 10 }}>{t('timetable:pdfImportResult.credentialsHint')}</div>
            <div className="pdf-import-scroll">
              <table className="data-table">
                <thead><tr><th>{t('common:fields.name')}</th><th>{t('common:fields.email')}</th><th>{t('common:fields.role')}</th><th>{t('timetable:pdfImportResult.table.tempPassword')}</th></tr></thead>
                <tbody>
                  {accounts.map((a, i) => (
                    <tr key={i}><td>{a.name}</td><td>{a.email}</td><td>{a.role}</td><td><code>{a.tempPassword}</code></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <div id="modal-footer" className="modal-footer">
        {accounts.length > 0 && (
          <>
            <button className="btn-sm" onClick={() => { exportAccountCredentialsCsv(accounts); toast(t('timetable:pdfImportResult.toastExported')); }}><i className="ti ti-download"></i> {t('timetable:pdfImportResult.exportCsv')}</button>
            <button className="btn-sm" onClick={() => { exportAccountCredentialsTxt(accounts, branding.orgName || 'UniScheduler'); toast(t('timetable:pdfImportResult.toastExported')); }}><i className="ti ti-file-text"></i> {t('timetable:pdfImportResult.exportReadableList')}</button>
          </>
        )}
        <button className="btn-primary" onClick={closeModal}>{t('timetable:pdfImportResult.done')}</button>
      </div>
    </>
  );
}
