import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateMigration } from '../../api.js';

export default function ValidateStep({ migrationId, onValidated, onBack }) {
  const { t } = useTranslation('admin');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  function check() {
    setLoading(true);
    validateMigration(migrationId)
      .then(setResult)
      .catch(err => setResult({ valid: false, errors: [{ message: err.message }] }))
      .finally(() => setLoading(false));
  }

  useEffect(check, [migrationId]);

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{t('admin:dataMigrationPage.validate.title')}</h3>
      {loading && <span className="spinner"></span>}
      {!loading && result && (
        result.valid ? (
          <p className="field-hint" style={{ color: 'var(--success, green)' }}>
            <i className="ti ti-circle-check" aria-hidden="true"></i> {t('admin:dataMigrationPage.validate.ok')}
          </p>
        ) : (
          <div className="roster-list">
            {result.errors.map((e, i) => (
              <div key={i} className="roster-row" style={{ color: 'var(--danger)' }}>
                {e.sourceTable ? `${e.sourceTable}: ` : ''}{e.message}
              </div>
            ))}
          </div>
        )
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn-sm" onClick={onBack}>
          <i className="ti ti-arrow-left" aria-hidden="true"></i> {t('admin:dataMigrationPage.validate.backToMapping')}
        </button>
        <button className="btn-sm" onClick={check} disabled={loading}>
          {t('admin:dataMigrationPage.validate.recheck')}
        </button>
        {result?.valid && (
          <button className="btn-primary" onClick={onValidated}>{t('admin:dataMigrationPage.validate.continue')}</button>
        )}
      </div>
    </div>
  );
}
