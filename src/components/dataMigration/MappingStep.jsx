import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMigration, fetchMigrationTargets, fetchMigrationMapping, saveMigrationMapping } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';

export default function MappingStep({ migrationId, onMapped, onBack }) {
  const { t } = useTranslation('admin');
  const { toast } = useToast();
  const [discoveredTables, setDiscoveredTables] = useState(null);
  const [targets, setTargets] = useState([]);
  const [rows, setRows] = useState([]);
  const { run, loading } = useAsyncAction();

  useEffect(() => {
    Promise.all([fetchMigration(migrationId), fetchMigrationTargets(), fetchMigrationMapping(migrationId)])
      .then(([migration, targetList, mapping]) => {
        setDiscoveredTables(migration.discoveredTables || []);
        setTargets(targetList);
        setRows((migration.discoveredTables || []).map(tbl => {
          const existing = mapping.find(m => m.sourceTable === tbl.name);
          return existing
            ? { sourceTable: tbl.name, destinationTarget: existing.destinationTarget, columnMap: existing.columnMap || {}, enabled: existing.enabled !== false }
            : { sourceTable: tbl.name, destinationTarget: null, columnMap: {}, enabled: false };
        }));
      })
      .catch(err => toast(err.message, 'error'));
  }, [migrationId, toast]);

  function updateRow(sourceTable, patch) {
    setRows(rs => rs.map(r => (r.sourceTable === sourceTable ? { ...r, ...patch } : r)));
  }

  function setTarget(sourceTable, destinationTarget) {
    updateRow(sourceTable, { destinationTarget: destinationTarget || null, columnMap: {}, enabled: !!destinationTarget });
  }

  function setFieldMap(sourceTable, field, sourceColumn) {
    setRows(rs => rs.map(r => (r.sourceTable === sourceTable ? { ...r, columnMap: { ...r.columnMap, [field]: sourceColumn || undefined } } : r)));
  }

  async function save() {
    try {
      await run(saveMigrationMapping(migrationId, rows));
      onMapped();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!discoveredTables) return <span className="spinner"></span>;

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{t('admin:dataMigrationPage.map.title')}</h3>
      {rows.map(row => {
        const table = discoveredTables.find(tbl => tbl.name === row.sourceTable);
        const target = targets.find(tg => tg.key === row.destinationTarget);
        return (
          <div key={row.sourceTable} className="panel" style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <input type="checkbox" checked={row.enabled} disabled={!row.destinationTarget}
                onChange={e => updateRow(row.sourceTable, { enabled: e.target.checked })} />
              <strong>{row.sourceTable}</strong>
              <span className="field-hint">({table?.rowCount ?? 0} {t('admin:dataMigrationPage.map.rows')})</span>
              <select style={{ marginInlineStart: 'auto' }} value={row.destinationTarget || ''} onChange={e => setTarget(row.sourceTable, e.target.value)}>
                <option value="">{t('admin:dataMigrationPage.map.skipTable')}</option>
                {targets.map(tg => <option key={tg.key} value={tg.key}>{tg.label}</option>)}
              </select>
            </div>

            {target && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('admin:dataMigrationPage.map.destinationField')}</th>
                    <th>{t('admin:dataMigrationPage.map.sourceColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(target.fields).map(([field, spec]) => (
                    <tr key={field}>
                      <td>{field}{spec.required ? ' *' : ''} <span className="field-hint">({spec.type})</span></td>
                      <td>
                        <select value={row.columnMap[field] || ''} onChange={e => setFieldMap(row.sourceTable, field, e.target.value)}>
                          <option value="">{t('admin:dataMigrationPage.map.unmapped')}</option>
                          {(table?.columns || []).map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-sm" onClick={onBack}>
          <i className="ti ti-arrow-left" aria-hidden="true"></i> {t('common:actions.back')}
        </button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading || !rows.some(r => r.enabled)} onClick={save}>
          {loading ? <span className="spinner"></span> : t('admin:dataMigrationPage.map.saveAndContinue')}
        </button>
      </div>
    </div>
  );
}
