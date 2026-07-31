import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { can } from '../../permissions.js';
import { csvEscape, downloadFile } from '../../utils.js';
import {
  fetchReportEntities, runReport, fetchReportDefinitions, runReportDefinition,
  saveReportDefinition, updateReportDefinition, deleteReportDefinition,
  exportReportPdf, exportReportXlsx, exportReportDefinitionPdf, exportReportDefinitionXlsx,
} from '../../api.js';

const NUMERIC_AGGREGATE_FNS = ['sum', 'avg'];

function emptyFilter() {
  return { field: '', op: '', value: '' };
}

function operatorLabel(t, op) {
  return t(`dashboard:reports.builder.operators.${op}`, { defaultValue: op });
}

function FilterRow({ filter, fields, onChange, onRemove, t }) {
  const field = fields.find(f => f.key === filter.field);
  const operators = field ? field.operators : [];

  const updateField = (fieldKey) => {
    const nextField = fields.find(f => f.key === fieldKey);
    onChange({ field: fieldKey, op: nextField?.operators?.[0] || '', value: '' });
  };

  const updateValue = (value) => onChange({ ...filter, value });

  return (
    <div className="report-filter-row">
      <select value={filter.field} onChange={e => updateField(e.target.value)} className="select-sm">
        <option value="">{t('dashboard:reports.builder.selectField')}</option>
        {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      <select value={filter.op} onChange={e => onChange({ ...filter, value: '', op: e.target.value })} className="select-sm" disabled={!field}>
        {operators.map(op => <option key={op} value={op}>{operatorLabel(t, op)}</option>)}
      </select>
      {field && filter.op === 'between' && (
        <>
          <input className="select-sm" type={field.type === 'date' ? 'date' : 'number'} value={filter.value?.[0] ?? ''}
            onChange={e => updateValue([e.target.value, filter.value?.[1] ?? ''])} />
          <input className="select-sm" type={field.type === 'date' ? 'date' : 'number'} value={filter.value?.[1] ?? ''}
            onChange={e => updateValue([filter.value?.[0] ?? '', e.target.value])} />
        </>
      )}
      {field && filter.op === 'in' && field.values && (
        <select multiple className="select-sm" value={filter.value || []}
          onChange={e => updateValue(Array.from(e.target.selectedOptions, o => o.value))}>
          {field.values.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
      {field && filter.op && filter.op !== 'between' && filter.op !== 'in' && field.type === 'enum' && (
        <select className="select-sm" value={filter.value} onChange={e => updateValue(e.target.value)}>
          <option value="">{t('dashboard:reports.builder.selectValue')}</option>
          {(field.values || []).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
      {field && filter.op && filter.op !== 'between' && filter.op !== 'in' && field.type !== 'enum' && (
        <input className="select-sm" type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={filter.value} onChange={e => updateValue(e.target.value)} />
      )}
      <button type="button" className="icon-btn" aria-label={t('common:actions.remove')} onClick={onRemove}>
        <i className="ti ti-x" aria-hidden="true"></i>
      </button>
    </div>
  );
}

/** Deterministic custom report builder: pick a whitelisted entity, columns, filters and an
    optional grouping (server-side whitelist — see api/src/reportEntities.js), run it, and
    optionally save the definition for reuse. Read-only preview; no ad-hoc SQL ever reaches the
    server, only field keys and filter values. */
export default function CustomReportBuilder() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { currentUser } = useAppData();
  const { toast } = useToast();
  const canWrite = can(currentUser.role, 'reports', 'write');

  const [entities, setEntities] = useState([]);
  const [entityKey, setEntityKey] = useState('');
  const [columns, setColumns] = useState([]);
  const [filters, setFilters] = useState([]);
  const [groupBy, setGroupBy] = useState('');
  const [aggregateField, setAggregateField] = useState('');
  const [aggregateFn, setAggregateFn] = useState('sum');

  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const [definitions, setDefinitions] = useState([]);
  const [activeDefinitionId, setActiveDefinitionId] = useState(null);
  const [saveName, setSaveName] = useState('');
  const [savingOpen, setSavingOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingKey, setExportingKey] = useState(null);

  useEffect(() => {
    fetchReportEntities().then(setEntities).catch(err => toast(err.message, 'error'));
    fetchReportDefinitions().then(setDefinitions).catch(err => toast(err.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entity = entities.find(e => e.key === entityKey);
  const groupableFields = entity ? entity.fields.filter(f => f.groupable) : [];
  const numericFields = entity ? entity.fields.filter(f => f.type === 'number') : [];

  const selectEntity = (key) => {
    setEntityKey(key);
    setActiveDefinitionId(null);
    const next = entities.find(e => e.key === key);
    setColumns(next ? next.fields.map(f => f.key) : []);
    setFilters([]);
    setGroupBy('');
    setAggregateField('');
    setResult(null);
  };

  const toggleColumn = (key) => {
    setColumns(cols => cols.includes(key) ? cols.filter(c => c !== key) : [...cols, key]);
  };

  const buildConfig = () => ({
    columns: groupBy ? undefined : columns,
    filters: filters.filter(f => f.field && f.op && f.value !== '' && f.value != null),
    groupBy: groupBy || undefined,
    aggregate: groupBy && aggregateField ? { field: aggregateField, fn: aggregateFn } : undefined,
  });

  const runCurrent = async () => {
    if (!entityKey) return;
    setRunning(true);
    try {
      const res = await runReport(entityKey, buildConfig());
      setResult(res);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const loadDefinition = async (def) => {
    setEntityKey(def.entity);
    setActiveDefinitionId(def.id);
    setSaveName(def.name);
    const cfg = def.config || {};
    const defEntity = entities.find(e => e.key === def.entity);
    setColumns(cfg.columns && cfg.columns.length ? cfg.columns : (defEntity ? defEntity.fields.map(f => f.key) : []));
    setFilters(cfg.filters || []);
    setGroupBy(cfg.groupBy || '');
    setAggregateField(cfg.aggregate?.field || '');
    setAggregateFn(cfg.aggregate?.fn || 'sum');
    setRunning(true);
    try {
      const res = await runReportDefinition(def.id);
      setResult(res);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const saveAsNew = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const created = await saveReportDefinition({ name: saveName.trim(), entity: entityKey, config: buildConfig() });
      setDefinitions(defs => [created, ...defs]);
      setActiveDefinitionId(created.id);
      setSavingOpen(false);
      toast(t('dashboard:reports.builder.saved'), 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateExisting = async () => {
    if (!activeDefinitionId) return;
    setSaving(true);
    try {
      const updated = await updateReportDefinition(activeDefinitionId, { name: saveName.trim() || undefined, entity: entityKey, config: buildConfig() });
      setDefinitions(defs => defs.map(d => d.id === updated.id ? updated : d));
      toast(t('dashboard:reports.builder.saved'), 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeDefinition = async (def) => {
    if (!window.confirm(t('dashboard:reports.builder.confirmDelete', { name: def.name }))) return;
    try {
      await deleteReportDefinition(def.id);
      setDefinitions(defs => defs.filter(d => d.id !== def.id));
      if (activeDefinitionId === def.id) { setActiveDefinitionId(null); setResult(null); }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const exportCsv = () => {
    if (!result) return;
    const header = result.columns.map(c => c.label);
    const lines = [header.join(',')].concat(
      result.rows.map(r => result.columns.map(c => csvEscape(r[c.key])).join(','))
    );
    downloadFile(`${entity?.label || 'report'}.csv`, lines.join('\n'), 'text/csv');
  };

  const exportCurrent = async (format) => {
    if (!entityKey) return;
    setExportingKey(`current-${format}`);
    try {
      const fn = format === 'pdf' ? exportReportPdf : exportReportXlsx;
      await fn(entityKey, buildConfig(), `${entity?.label || 'report'}.${format}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setExportingKey(null);
    }
  };

  const exportSavedDefinition = async (def, format) => {
    setExportingKey(`${def.id}-${format}`);
    try {
      const fn = format === 'pdf' ? exportReportDefinitionPdf : exportReportDefinitionXlsx;
      await fn(def.id, `${def.name}.${format}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setExportingKey(null);
    }
  };

  const chartData = useMemo(() => result?.chart?.data || [], [result]);

  return (
    <div className="report-builder">
      <div className="panel-row" style={{ alignItems: 'flex-start' }}>
        <div className="panel" style={{ flex: '2 1 480px' }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('dashboard:reports.builder.title')}</div>
              <div className="panel-subtitle">{t('dashboard:reports.builder.subtitle')}</div>
            </div>
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-row">
              <div className="form-label">{t('dashboard:reports.builder.entity')}</div>
              <select value={entityKey} onChange={e => selectEntity(e.target.value)}>
                <option value="">{t('dashboard:reports.builder.selectEntity')}</option>
                {entities.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
            </div>

            {entity && (
              <>
                <div className="form-row">
                  <div className="form-label">{t('dashboard:reports.builder.columns')}</div>
                  <div className="report-column-chips">
                    {entity.fields.map(f => (
                      <label key={f.key} className={'chip-checkbox' + (columns.includes(f.key) ? ' active' : '')}>
                        <input type="checkbox" checked={columns.includes(f.key)} onChange={() => toggleColumn(f.key)} />
                        {f.label}
                      </label>
                    ))}
                  </div>
                  {groupBy && <div className="field-hint">{t('dashboard:reports.builder.columnsIgnoredWhenGrouped')}</div>}
                </div>

                <div className="form-row">
                  <div className="form-label">{t('dashboard:reports.builder.filters')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filters.map((f, i) => (
                      <FilterRow key={i} filter={f} fields={entity.fields}
                        onChange={next => setFilters(fs => fs.map((x, idx) => idx === i ? next : x))}
                        onRemove={() => setFilters(fs => fs.filter((_, idx) => idx !== i))}
                        t={t} />
                    ))}
                    <button type="button" className="btn-sm" onClick={() => setFilters(fs => [...fs, emptyFilter()])}>
                      <i className="ti ti-plus" aria-hidden="true"></i> {t('dashboard:reports.builder.addFilter')}
                    </button>
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="form-row">
                    <div className="form-label">{t('dashboard:reports.builder.groupBy')}</div>
                    <select value={groupBy} onChange={e => { setGroupBy(e.target.value); setAggregateField(''); }}>
                      <option value="">{t('dashboard:reports.builder.noGrouping')}</option>
                      {groupableFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                  {groupBy && numericFields.length > 0 && (
                    <div className="form-row">
                      <div className="form-label">{t('dashboard:reports.builder.aggregate')}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select value={aggregateFn} onChange={e => setAggregateFn(e.target.value)}>
                          {NUMERIC_AGGREGATE_FNS.map(fn => <option key={fn} value={fn}>{t(`dashboard:reports.builder.aggregateFns.${fn}`)}</option>)}
                        </select>
                        <select value={aggregateField} onChange={e => setAggregateField(e.target.value)}>
                          <option value="">{t('dashboard:reports.builder.countOnly')}</option>
                          {numericFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" className={'btn-primary' + (running ? ' btn-loading' : '')} disabled={running} onClick={runCurrent}>
                    {running ? <span className="spinner"></span> : t('dashboard:reports.builder.run')}
                  </button>
                  {canWrite && !savingOpen && (
                    <button type="button" className="btn-sm" onClick={() => { setSavingOpen(true); if (!saveName) setSaveName(entity.label); }}>
                      {t('dashboard:reports.builder.saveAs')}
                    </button>
                  )}
                  {canWrite && activeDefinitionId && (
                    <button type="button" className={'btn-sm' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={updateExisting}>
                      {t('dashboard:reports.builder.updateSaved')}
                    </button>
                  )}
                  {result && (
                    <>
                      <button type="button" className="btn-sm" onClick={exportCsv}>
                        <i className="ti ti-download" aria-hidden="true"></i> {t('dashboard:reports.builder.exportCsv')}
                      </button>
                      <button type="button" className="btn-sm" disabled={exportingKey === 'current-pdf'} onClick={() => exportCurrent('pdf')}>
                        {exportingKey === 'current-pdf' ? <span className="spinner"></span> : <><i className="ti ti-file-type-pdf" aria-hidden="true"></i> {t('dashboard:reports.builder.exportPdf')}</>}
                      </button>
                      <button type="button" className="btn-sm" disabled={exportingKey === 'current-xlsx'} onClick={() => exportCurrent('xlsx')}>
                        {exportingKey === 'current-xlsx' ? <span className="spinner"></span> : <><i className="ti ti-file-type-xls" aria-hidden="true"></i> {t('dashboard:reports.builder.exportXlsx')}</>}
                      </button>
                    </>
                  )}
                </div>

                {savingOpen && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="select-sm" style={{ flex: 1 }} value={saveName} onChange={e => setSaveName(e.target.value)}
                      placeholder={t('dashboard:reports.builder.reportNamePlaceholder')} />
                    <button type="button" className={'btn-primary' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={saveAsNew}>
                      {saving ? <span className="spinner"></span> : t('common:actions.save')}
                    </button>
                    <button type="button" className="btn-sm" onClick={() => setSavingOpen(false)}>{t('common:actions.cancel')}</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="panel" style={{ flex: '1 1 260px' }}>
          <div className="panel-header">
            <div className="panel-title">{t('dashboard:reports.builder.savedReports')}</div>
          </div>
          {definitions.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('dashboard:reports.builder.noSavedReports')}</div>}
          <ul className="report-definition-list">
            {definitions.map(def => (
              <li key={def.id} className={def.id === activeDefinitionId ? 'active' : ''}>
                <button type="button" className="report-definition-item" onClick={() => loadDefinition(def)}>
                  <span>{def.name}</span>
                  <span className="field-hint">{entities.find(e => e.key === def.entity)?.label || def.entity}</span>
                </button>
                <button type="button" className="icon-btn" aria-label={t('dashboard:reports.builder.exportPdf')} title={t('dashboard:reports.builder.exportPdf')}
                  disabled={exportingKey === `${def.id}-pdf`} onClick={() => exportSavedDefinition(def, 'pdf')}>
                  {exportingKey === `${def.id}-pdf` ? <span className="spinner"></span> : <i className="ti ti-file-type-pdf" aria-hidden="true"></i>}
                </button>
                <button type="button" className="icon-btn" aria-label={t('dashboard:reports.builder.exportXlsx')} title={t('dashboard:reports.builder.exportXlsx')}
                  disabled={exportingKey === `${def.id}-xlsx`} onClick={() => exportSavedDefinition(def, 'xlsx')}>
                  {exportingKey === `${def.id}-xlsx` ? <span className="spinner"></span> : <i className="ti ti-file-type-xls" aria-hidden="true"></i>}
                </button>
                {canWrite && (
                  <button type="button" className="icon-btn" aria-label={t('common:actions.delete')} onClick={() => removeDefinition(def)}>
                    <i className="ti ti-trash" aria-hidden="true"></i>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {result && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('dashboard:reports.builder.results')}</div>
              {result.truncated && <div className="panel-subtitle">{t('dashboard:reports.builder.truncated')}</div>}
            </div>
          </div>

          {result.chart && (
            <div style={{ padding: 14 }}>
              <ResponsiveContainer width="100%" height={260}>
                {result.chart.type === 'line' ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" stroke="#4B7FE8" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#4B7FE8" />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr>{result.columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>{result.columns.map(c => <td key={c.key}>{row[c.key] ?? '—'}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {result.rows.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('dashboard:reports.builder.noRows')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
