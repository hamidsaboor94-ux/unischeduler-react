import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMigrationReport, rollbackMigration } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';

export default function ReportStep({ migrationId, onDone }) {
  const { t } = useTranslation('admin');
  const { toast } = useToast();
  const { confirmAction } = useModal();
  const [report, setReport] = useState(null);
  const { run, loading } = useAsyncAction();

  function reload() {
    fetchMigrationReport(migrationId).then(setReport).catch(err => toast(err.message, 'error'));
  }

  useEffect(reload, [migrationId, toast]);

  function confirmRollback() {
    confirmAction(t('admin:dataMigrationPage.report.confirmRollback'), doRollback, t('admin:dataMigrationPage.report.rollbackButton'));
  }

  async function doRollback() {
    try {
      const result = await run(rollbackMigration(migrationId));
      toast(result.method === 'snapshot_restore'
        ? t('admin:dataMigrationPage.report.rollbackToastSnapshot')
        : t('admin:dataMigrationPage.report.rollbackToastOk'));
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!report) return <span className="spinner"></span>;
  const m = report.migration;

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{t('admin:dataMigrationPage.report.title')}</h3>

      <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.report.status')}</div><div>{m.status}</div></div>
      <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.report.inserted')}</div><div>{m.insertedRows}</div></div>
      <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.report.errors')}</div><div>{m.errorRows}</div></div>
      {m.errorMessage && (
        <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.report.errorMessage')}</div><div style={{ color: 'var(--danger)' }}>{m.errorMessage}</div></div>
      )}

      <h4 style={{ margin: '16px 0 8px', fontSize: 13 }}>{t('admin:dataMigrationPage.report.batches')}</h4>
      <table className="data-table">
        <thead><tr>
          <th>{t('admin:dataMigrationPage.report.sourceTable')}</th>
          <th>{t('admin:dataMigrationPage.report.target')}</th>
          <th>{t('admin:dataMigrationPage.report.batch')}</th>
          <th>{t('admin:dataMigrationPage.report.inserted')}</th>
          <th>{t('admin:dataMigrationPage.report.errors')}</th>
        </tr></thead>
        <tbody>
          {report.batches.length === 0 ? (
            <tr><td colSpan={5} className="field-hint" style={{ padding: 14 }}>{t('admin:dataMigrationPage.report.noBatches')}</td></tr>
          ) : report.batches.map(b => (
            <tr key={b.id}>
              <td>{b.sourceTable}</td><td>{b.destinationTarget}</td><td>{b.batchNumber}</td>
              <td>{b.insertedCount}</td><td>{b.errorCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {report.logs.length > 0 && (
        <>
          <h4 style={{ margin: '16px 0 8px', fontSize: 13 }}>{t('admin:dataMigrationPage.report.errorLog')}</h4>
          <div className="roster-list">
            {report.logs.map(l => (
              <div key={l.id} className="roster-row" style={{ color: 'var(--danger)' }}>
                {l.sourceTable ? `${l.sourceTable}: ` : ''}{l.message}
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn-sm" onClick={onDone}>{t('admin:dataMigrationPage.report.done')}</button>
        {m.status === 'completed' && (
          <button className={'modal-danger-btn' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={confirmRollback}>
            {loading ? <span className="spinner"></span> : <><i className="ti ti-rotate" aria-hidden="true"></i> {t('admin:dataMigrationPage.report.rollbackButton')}</>}
          </button>
        )}
      </div>
    </div>
  );
}
