import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { discoverMigration } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function DiscoverStep({ migrationId, onDiscovered }) {
  const { t } = useTranslation('admin');
  const { toast } = useToast();
  const [tables, setTables] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    discoverMigration(migrationId)
      .then(result => { if (!cancelled) setTables(result.tables); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [migrationId]);

  function retry() {
    setError(null);
    setLoading(true);
    discoverMigration(migrationId)
      .then(result => setTables(result.tables))
      .catch(err => { setError(err.message); toast(err.message, 'error'); })
      .finally(() => setLoading(false));
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{t('admin:dataMigrationPage.discover.title')}</h3>
      {loading && <span className="spinner"></span>}
      {error && (
        <div>
          <p className="field-hint" style={{ color: 'var(--danger)' }}>{error}</p>
          <button className="btn-sm" onClick={retry}>{t('admin:dataMigrationPage.discover.retry')}</button>
        </div>
      )}
      {tables && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('admin:dataMigrationPage.discover.table')}</th>
                <th>{t('admin:dataMigrationPage.discover.rows')}</th>
                <th>{t('admin:dataMigrationPage.discover.columns')}</th>
                <th>{t('admin:dataMigrationPage.discover.primaryKey')}</th>
              </tr>
            </thead>
            <tbody>
              {tables.map(tbl => (
                <tr key={tbl.name}>
                  <td>{tbl.name}</td>
                  <td>{tbl.rowCount}</td>
                  <td>{tbl.columns.length}</td>
                  <td>{tbl.primaryKey.length ? tbl.primaryKey.join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn-primary" style={{ marginTop: 14 }} onClick={onDiscovered}>
            {t('admin:dataMigrationPage.discover.continue')}
          </button>
        </>
      )}
    </div>
  );
}
