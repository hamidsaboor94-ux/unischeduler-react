import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { startMigrationDryRun } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useMigrationProgress } from '../../hooks/useMigrationProgress.js';

const TERMINAL_STATUSES = new Set(['dry_run', 'failed', 'cancelled']);

export default function DryRunStep({ migrationId, onDryRunComplete, onBack }) {
  const { t } = useTranslation('admin');
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const progress = useMigrationProgress(migrationId, { enabled: running });

  useEffect(() => {
    if (progress && TERMINAL_STATUSES.has(progress.status)) setRunning(false);
  }, [progress]);

  async function start() {
    try {
      await startMigrationDryRun(migrationId);
      setRunning(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const pct = progress && progress.totalRows ? Math.min(100, Math.round((progress.processedRows / progress.totalRows) * 100)) : 0;

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{t('admin:dataMigrationPage.dryRun.title')}</h3>
      <p className="field-hint" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>{t('admin:dataMigrationPage.dryRun.hint')}</p>

      {!progress && (
        <button className="btn-primary" onClick={start}>
          <i className="ti ti-player-play" aria-hidden="true"></i> {t('admin:dataMigrationPage.dryRun.start')}
        </button>
      )}

      {progress && (
        <div>
          {progress.status === 'running' && (
            <>
              <div className="migration-progress-bar"><div className="migration-progress-fill" style={{ width: `${pct}%` }}></div></div>
              <p className="field-hint">{t('admin:dataMigrationPage.dryRun.processing', { table: progress.currentTable, processed: progress.processedRows, total: progress.totalRows })}</p>
            </>
          )}
          {progress.status === 'dry_run' && (
            <>
              <p className="field-hint">
                {t('admin:dataMigrationPage.dryRun.summary', { estimated: progress.insertedRows, errors: progress.errorRows })}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-sm" onClick={start}>{t('admin:dataMigrationPage.dryRun.rerun')}</button>
                <button className="btn-primary" onClick={onDryRunComplete}>{t('admin:dataMigrationPage.dryRun.continue')}</button>
              </div>
            </>
          )}
          {progress.status === 'failed' && (
            <div>
              <p className="field-hint" style={{ color: 'var(--danger)' }}>{t('admin:dataMigrationPage.dryRun.failed')}</p>
              <button className="btn-sm" onClick={start}>{t('admin:dataMigrationPage.dryRun.rerun')}</button>
            </div>
          )}
        </div>
      )}

      <button className="btn-sm" style={{ marginTop: 14 }} onClick={onBack}>
        <i className="ti ti-arrow-left" aria-hidden="true"></i> {t('common:actions.back')}
      </button>
    </div>
  );
}
