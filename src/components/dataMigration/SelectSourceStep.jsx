import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMigrationSourceTypes } from '../../api.js';

const SOURCE_TYPE_ICON = {
  sqlite: 'ti-file-database', mysql: 'ti-brand-mysql', postgres: 'ti-elephant',
  mssql: 'ti-brand-windows', csv: 'ti-file-type-csv', excel: 'ti-file-spreadsheet',
};

export default function SelectSourceStep({ onSourceTypeSelected }) {
  const { t } = useTranslation('admin');
  const [sourceTypes, setSourceTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMigrationSourceTypes()
      .then(setSourceTypes)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <span className="spinner"></span>;
  if (error) return <div className="field-hint" style={{ color: 'var(--danger)' }}>{error}</div>;

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{t('admin:dataMigrationPage.selectSource.title')}</h3>
      <div className="migration-source-grid">
        {sourceTypes.map(type => (
          <button key={type} className="migration-source-card" onClick={() => onSourceTypeSelected(type)}>
            <i className={'ti ' + (SOURCE_TYPE_ICON[type] || 'ti-database')} aria-hidden="true"></i>
            <span>{t(`admin:dataMigrationPage.sourceTypes.${type}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
