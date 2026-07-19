import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';

const ACTION_PILL = {
  create: 'pill-green', 'bulk-import': 'pill-green', 'create-grade-item': 'pill-green',
  update: 'pill-blue', 'set-grade': 'pill-blue', 'set-grade-score': 'pill-blue', 'update-grade-item': 'pill-blue', 'reset-password': 'pill-amber',
  delete: 'pill-red', 'delete-grade-item': 'pill-red',
};

function auditDetailsSummary(entry, dash) {
  if (!entry.details) return dash;
  try {
    const d = JSON.parse(entry.details);
    return Object.entries(d).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(', ') || dash;
  } catch {
    return entry.details;
  }
}

export default function AuditLogPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { auditLog } = useAppData();
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  const actions = [...new Set(auditLog.map(e => e.action))].sort();
  const entities = [...new Set(auditLog.map(e => e.entityType))].sort();

  let filtered = auditLog;
  if (actionFilter) filtered = filtered.filter(e => e.action === actionFilter);
  if (entityFilter) filtered = filtered.filter(e => e.entityType === entityFilter);

  return (
    <Section name="audit">
      <div className="topbar">
        <i className="ti ti-history" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('admin:auditLogPage.title')}</h2>
        <div className="topbar-actions">
          <select className="select-sm" value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
            <option value="">{t('admin:auditLogPage.allActions')}</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="select-sm" value={entityFilter} onChange={e => setEntityFilter(e.target.value)}>
            <option value="">{t('admin:auditLogPage.allEntities')}</option>
            {entities.map(en => <option key={en} value={en}>{en}</option>)}
          </select>
        </div>
      </div>
      <div id="content">
        <div className="panel">
          <table className="data-table">
            <thead><tr><th>{t('admin:auditLogPage.table.time')}</th><th>{t('admin:auditLogPage.table.user')}</th><th>{t('admin:auditLogPage.table.action')}</th><th>{t('admin:auditLogPage.table.entity')}</th><th>{t('admin:auditLogPage.table.details')}</th></tr></thead>
            <tbody>
              {filtered.length ? filtered.map((e, i) => (
                <tr key={e.id ?? i}>
                  <td>{new Date(e.createdAt + 'Z').toLocaleString()}</td>
                  <td>{e.userName || t('admin:auditLogPage.unknownUser')}</td>
                  <td><span className={'pill ' + (ACTION_PILL[e.action] || 'pill-gray')}>{e.action}</span></td>
                  <td>{e.entityType}{e.entityId ? ` #${e.entityId}` : ''}</td>
                  <td className="field-hint">{auditDetailsSummary(e, t('common:notApplicable'))}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="field-hint" style={{ padding: 14 }}>{t('admin:auditLogPage.empty')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
