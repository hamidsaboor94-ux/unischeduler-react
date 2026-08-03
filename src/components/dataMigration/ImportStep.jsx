import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { startMigrationImport, cancelMigration } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useMigrationProgress } from '../../hooks/useMigrationProgress.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export default function ImportStep({ migrationId, onImportComplete, onBack }) {
  const { t } = useTranslation('admin');
  const { toast } = useToast();
  const { confirmAction } = useModal();
  const [running, setRunning] = useState(false);
  const progress = useMigrationProgress(migrationId, { enabled: running });

  useEffect(() => {
    if (progress && TERMINAL_STATUSES.has(progress.status)) setRunning(false);
  }, [progress]);

  async function start() {
    try {
      await startMigrationImport(migrationId);
      setRunning(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function confirmCancel() {
    confirmAction(t('admin:dataMigrationPage.import.confirmCancel'), async () => {
      try {
        await cancelMigration(migrationId);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const pct = progress && progress.totalRows ? Math.min(100, Math.round((progress.processedRows / progress.totalRows) * 100)) : 0;

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{t('admin:dataMigrationPage.import.title')}</h3>
      <p className="field-hint" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>{t('admin:dataMigrationPage.import.hint')}</p>

      {!progress && (
        <button className="btn-primary" onClick={start}>
          <i className="ti ti-player-play" aria-hidden="true"></i> {t('admin:dataMigrationPage.import.start')}
        </button>
      )}

      {progress && (
        <div>
          {progress.status === 'running' && (
            <>
              <div className="migration-progress-bar"><div className="migration-progress-fill" style={{ width: `${pct}%` }}></div></div>
              <p className="field-hint">{t('admin:dataMigrationPage.import.processing', { table: progress.currentTable, processed: progress.processedRows, total: progress.totalRows })}</p>
              <button className="modal-danger-btn" onClick={confirmCancel}>
                <i className="ti ti-player-stop" aria-hidden="true"></i> {t('admin:dataMigrationPage.import.cancel')}
              </button>
            </>
          )}
          {progress.status === 'completed' && (
            <>
              <p className="field-hint" style={{ color: 'var(--success, green)' }}>
                {t('admin:dataMigrationPage.import.summary', { inserted: progress.insertedRows, errors: progress.errorRows })}
              </p>
              <button className="btn-primary" onClick={onImportComplete}>{t('admin:dataMigrationPage.import.viewReport')}</button>
            </>
          )}
          {progress.status === 'cancelled' && (
            <p className="field-hint">{t('admin:dataMigrationPage.import.cancelled')}</p>
          )}
          {progress.status === 'failed' && (
            <div>
              <p className="field-hint" style={{ color: 'var(--danger)' }}>{t('admin:dataMigrationPage.import.failed')}</p>
              <button className="btn-sm" onClick={start}>{t('admin:dataMigrationPage.import.retry')}</button>
            </div>
          )}
        </div>
      )}

      {!running && (
        <button className="btn-sm" style={{ marginTop: 14 }} onClick={onBack}>
          <i className="ti ti-arrow-left" aria-hidden="true"></i> {t('common:actions.back')}
        </button>
      )}
    </div>
  );
}
