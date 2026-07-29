import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { api } from '../api.js';
import { roleLabel } from '../roleNames.js';
import { PALETTE, COLOR_HEX } from '../utils.js';
import { StatCard } from './ui/StatCard.jsx';

const ROLE_CHANGES_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const GROUP_WINDOW_MS = 10 * 60 * 1000;
const RECENT_ROLE_CHANGES_LIMIT = 5;
const AUDIT_GROUPS_LIMIT = 8;

const ACTIVITY_ICON = {
  create: 'ti-square-rounded-plus', update: 'ti-pencil', delete: 'ti-trash',
  'reset-password': 'ti-key', 'change-password': 'ti-key', 'update-profile': 'ti-user-edit',
  'upload-logo': 'ti-photo', 'remove-logo': 'ti-photo-off',
  restore: 'ti-database-import', export: 'ti-database-export',
};

// Most action strings in db.js follow "verb-object" (update-grade-item, mark-attendance,
// set-grade-score) so splitting on the first hyphen and past-tensing the verb reads naturally.
// This map only covers irregular verbs; ACTION_OVERRIDES below covers the handful of actions
// that don't follow the verb-object shape at all (auto-*, bulk-*, progress-*, system-reset).
const VERB_PAST = {
  create: 'created', update: 'updated', delete: 'deleted', restore: 'restored', export: 'exported',
  revoke: 'revoked', set: 'set', mark: 'marked', post: 'posted', upload: 'uploaded', remove: 'removed',
  record: 'recorded', generate: 'generated', enroll: 'enrolled', approve: 'approved', grade: 'graded',
  publish: 'published', duplicate: 'duplicated', schedule: 'scheduled', cancel: 'cancelled',
  notify: 'notified', archive: 'archived', reset: 'reset', evaluate: 'evaluated', import: 'imported',
  resolve: 'resolved',
};
const ACTION_OVERRIDES = {
  'system-reset': 'System reset',
  'auto-schedule': 'Exams auto-scheduled',
  'auto-resolve-conflict': 'Conflict auto-resolved',
  'bulk-import': 'Records bulk-imported',
  'bulk-update': 'Records bulk-updated',
  'bulk-enroll': 'Students bulk-enrolled',
  'bulk-enroll-override': 'Students bulk-enrolled (override)',
  'progress-evaluate': 'Academic progress evaluated',
  'progress-override': 'Academic progress overridden',
  'enroll-student-override': 'Student enrolled (override)',
};

function verbPast(verb) {
  return VERB_PAST[verb] || (verb.endsWith('e') ? `${verb}d` : `${verb}ed`);
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Plain-language phrase for a raw (action, entityType) audit pair, e.g.
    ('set-grade-score', 'grade_scores') -> "Grade score set", ('delete', 'courses') -> "Courses deleted". */
function describeEvent(action, entityType) {
  if (ACTION_OVERRIDES[action]) return ACTION_OVERRIDES[action];
  const parts = action.split('-');
  if (parts.length > 1) return `${capitalize(parts.slice(1).join(' '))} ${verbPast(parts[0])}`;
  return `${capitalize(entityType.replace(/_/g, ' '))} ${verbPast(action)}`;
}

function isDestructive(action) { return action === 'delete' || action.startsWith('delete-'); }

// Deterministic on role name, so the same role always gets the same legend/bar color.
function roleColor(role) {
  let hash = 0;
  for (let i = 0; i < role.length; i++) hash = (hash * 31 + role.charCodeAt(i)) % PALETTE.length;
  return PALETTE[hash];
}

/** Audit log arrives newest-first — collapse consecutive rows from the same actor doing the same
    action on the same entity type within GROUP_WINDOW_MS into one row with a count, so a bulk
    edit session (e.g. 20 grade-score updates in a row) doesn't flood the card. */
function groupAuditEvents(entries) {
  const groups = [];
  for (const e of entries) {
    const t = new Date(`${e.createdAt}Z`).getTime();
    const last = groups[groups.length - 1];
    if (last && last.userId === e.userId && last.action === e.action && last.entityType === e.entityType
      && last.newestTime - t <= GROUP_WINDOW_MS) {
      last.count += 1;
    } else {
      groups.push({
        id: e.id, userId: e.userId, userName: e.userName, action: e.action,
        entityType: e.entityType, count: 1, newestTime: t,
      });
    }
  }
  return groups;
}

/** Super Admin's platform & security dashboard — distinct from the academic-operations view
    every other role sees (see DashboardPage.jsx). This role owns users/roles, security signals,
    system health, and the audit trail — not academic workflows (courses/departments/exams/
    conflicts/applications), which live on the dashboards of the roles that actually own them and
    are still reachable from their own pages via the sidebar. Every number here comes from data
    already loaded in AppDataContext or the read-only GET /api/system-health check; fields with no
    real tracking yet (forbidden attempts, failed logins) render as "—" with a muted label rather
    than a fabricated zero. */
export default function SuperAdminDashboard() {
  const { t } = useTranslation(['dashboard', 'admin', 'common']);
  const { allUsers, auditLog, branding } = useAppData();
  const { showSection } = useNavigation();
  const { openModal } = useModal();

  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('GET', '/system-health')
      .then(res => { if (!cancelled) setHealth(res); })
      .catch(() => { if (!cancelled) setHealthError(true); })
      .finally(() => { if (!cancelled) setHealthLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const roleBreakdown = useMemo(() => {
    const counts = new Map();
    allUsers.forEach(u => counts.set(u.role, (counts.get(u.role) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [allUsers]);

  const usersById = useMemo(() => new Map(allUsers.map(u => [String(u.id), u])), [allUsers]);

  // A "role change" is a PUT /users/:id whose body actually included a role field (see
  // UsersPage.jsx's changeUserRole, which sends {role} alone) — distinct from a plain
  // name/department edit, which also logs entityType:'users' action:'update' but omits `role`.
  const roleChangeEvents = useMemo(() => auditLog.filter(e => {
    if (e.entityType !== 'users' || e.action !== 'update' || !e.details) return false;
    try { return JSON.parse(e.details).role !== undefined; } catch { return false; }
  }), [auditLog]);

  const roleChangesCount = useMemo(() => {
    const cutoff = Date.now() - ROLE_CHANGES_WINDOW_MS;
    return roleChangeEvents.filter(e => new Date(`${e.createdAt}Z`).getTime() >= cutoff).length;
  }, [roleChangeEvents]);

  const recentRoleChanges = roleChangeEvents.slice(0, RECENT_ROLE_CHANGES_LIMIT);
  const auditGroups = useMemo(() => groupAuditEvents(auditLog).slice(0, AUDIT_GROUPS_LIMIT), [auditLog]);

  const lastBackup = useMemo(
    () => auditLog.find(e => e.entityType === 'backup' && e.action === 'export'),
    [auditLog]
  );

  const pulseUnknown = healthLoading || healthError;
  const dbOk = health?.database === 'ok';
  const apiOk = health?.api === 'ok';
  const authOk = health?.authentication === 'ok';
  const systemHealthy = !pulseUnknown && dbOk && apiOk && authOk;

  const services = [
    { key: 'api', label: t('dashboard.superAdmin.systemStatus.api'), ok: apiOk },
    { key: 'database', label: t('dashboard.superAdmin.systemStatus.database'), ok: dbOk },
    { key: 'auth', label: t('dashboard.superAdmin.systemStatus.auth'), ok: authOk },
  ];

  return (
    <>
      <div className="dash-welcome-row">
        <div>
          <div className="dash-welcome-title">{t('dashboard.superAdmin.header.title')}</div>
          <div className="panel-subtitle">{t('dashboard.superAdmin.header.subtitle')}</div>
        </div>
        <span className={'pill dash-health-pill ' + (pulseUnknown ? 'pill-gray' : systemHealthy ? 'pill-green' : 'pill-red')}>
          <i
            className={'ti ' + (pulseUnknown ? 'ti-help-circle' : systemHealthy ? 'ti-circle-check' : 'ti-alert-triangle')}
            aria-hidden="true"
          ></i>
          {pulseUnknown
            ? t('dashboard.superAdmin.header.checking')
            : systemHealthy ? t('dashboard.superAdmin.header.healthy') : t('dashboard.superAdmin.header.attention')}
        </span>
      </div>

      <div className="stat-grid">
        <StatCard
          icon="ti-users-group" hue="indigo"
          label={t('dashboard.superAdmin.kpi.totalUsers')}
          value={allUsers.length}
        />
        <StatCard
          icon="ti-replace" hue="indigo"
          label={t('dashboard.superAdmin.kpi.roleChanges')}
          value={roleChangesCount}
        />
        <StatCard
          icon="ti-shield-x" hue="indigo"
          label={t('dashboard.superAdmin.kpi.forbiddenAttempts')}
          value={<span style={{ fontSize: 14, color: 'var(--text-muted)' }}>—</span>}
          sub={t('dashboard.superAdmin.kpi.notTracked')}
        />
        <StatCard
          icon="ti-lock-exclamation" hue="indigo"
          label={t('dashboard.superAdmin.kpi.failedLogins')}
          value={<span style={{ fontSize: 14, color: 'var(--text-muted)' }}>—</span>}
          sub={t('dashboard.superAdmin.kpi.notTracked')}
        />
      </div>

      <div className="panel-row dash-two-col">
        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.superAdmin.usersRoles.title')}</div>
                <div className="panel-subtitle">{t('dashboard.superAdmin.usersRoles.subtitle')}</div>
              </div>
              <button className="btn-sm" onClick={() => showSection('users')}>{t('dashboard.superAdmin.usersRoles.manage')}</button>
            </div>

            <div className="kpi-value" style={{ marginBottom: 2 }}>{allUsers.length}</div>
            <div className="kpi-sub" style={{ marginBottom: 14 }}>{t('dashboard.superAdmin.usersRoles.totalUsers')}</div>

            <div className="role-bar">
              {roleBreakdown.map(([role, n]) => (
                <div
                  key={role} className="role-bar-seg"
                  style={{ flexGrow: n, background: COLOR_HEX[roleColor(role)] }}
                  title={`${roleLabel(role, t, branding)}: ${n}`}
                ></div>
              ))}
            </div>
            <div className="role-bar-legend">
              {roleBreakdown.map(([role, n]) => (
                <div className="role-bar-legend-item" key={role}>
                  <span className="role-bar-dot" style={{ background: COLOR_HEX[roleColor(role)] }}></span>
                  {roleLabel(role, t, branding)} <span className="role-bar-legend-count">{n}</span>
                </div>
              ))}
            </div>

            <div className="panel-subtitle" style={{ margin: '16px 0 8px' }}>{t('dashboard.superAdmin.usersRoles.recentChanges')}</div>
            <div className="alert-list">
              {recentRoleChanges.length === 0 && (
                <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.superAdmin.usersRoles.noRecentChanges')}</div>
              )}
              {recentRoleChanges.map(e => {
                let role = null;
                try { role = JSON.parse(e.details).role; } catch { /* unparsable details, skip */ }
                const target = usersById.get(String(e.entityId));
                return (
                  <div className="alert-item alert-neutral" key={e.id} onClick={() => showSection('users')}>
                    <i className="ti ti-user-shield" aria-hidden="true"></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">
                        {t('dashboard.superAdmin.usersRoles.changeLine', {
                          actor: e.userName,
                          target: target?.name || target?.email || `#${e.entityId}`,
                          role: roleLabel(role, t, branding),
                        })}
                      </div>
                      <div className="alert-desc">{new Date(`${e.createdAt}Z`).toLocaleString()}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.superAdmin.auditTrail.title')}</div>
                <div className="panel-subtitle">{t('dashboard.superAdmin.auditTrail.subtitle')}</div>
              </div>
              <button className="btn-sm" onClick={() => showSection('audit')}>{t('dashboard.fullView')}</button>
            </div>
            <div className="alert-list">
              {auditGroups.length === 0 && (
                <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.superAdmin.auditTrail.empty')}</div>
              )}
              {auditGroups.map(g => {
                const destructive = isDestructive(g.action);
                return (
                  <div className={'alert-item ' + (destructive ? 'alert-danger' : 'alert-neutral')} key={g.id} onClick={() => showSection('audit')}>
                    <i className={'ti ' + (destructive ? 'ti-trash' : (ACTIVITY_ICON[g.action] || 'ti-info-circle'))} aria-hidden="true"></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">
                        {describeEvent(g.action, g.entityType)}
                        {g.count > 1 ? ` · ${t('dashboard.superAdmin.auditTrail.eventCount', { count: g.count })}` : ''}
                      </div>
                      <div className="alert-desc">{g.userName} · {new Date(g.newestTime).toLocaleString()}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">{t('dashboard.superAdmin.systemStatus.title')}</div>
            </div>
            <div className="svc-list">
              {services.map(svc => (
                <div className="svc-row" key={svc.key}>
                  <span className={'status-dot ' + (pulseUnknown ? 'status-dot--unknown' : svc.ok ? 'status-dot--ok' : 'status-dot--down')}></span>
                  <span className="svc-label">{svc.label}</span>
                  <span className="svc-value">
                    {pulseUnknown ? t('dashboard.superAdmin.systemStatus.checking') : svc.ok ? t('dashboard.superAdmin.systemStatus.ok') : t('dashboard.superAdmin.systemStatus.down')}
                  </span>
                </div>
              ))}
              <div className="svc-row">
                <i className="ti ti-database-export" aria-hidden="true"></i>
                <span className="svc-label">{t('dashboard.superAdmin.systemStatus.lastBackup')}</span>
                <span className="svc-value">
                  {lastBackup ? new Date(`${lastBackup.createdAt}Z`).toLocaleString() : t('dashboard.superAdmin.systemStatus.noBackup')}
                </span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">{t('dashboard.superAdmin.quickActions.title')}</div>
            </div>
            <div className="quick-actions-grid">
              <button className="btn-sm" onClick={() => openModal('create-account')}>
                <i className="ti ti-user-plus"></i> {t('dashboard.superAdmin.quickActions.createUser')}
              </button>
              <button className="btn-sm" onClick={() => showSection('users')}>
                <i className="ti ti-shield-cog"></i> {t('dashboard.superAdmin.quickActions.manageRoles')}
              </button>
              <button className="btn-sm" onClick={() => showSection('branding')}>
                <i className="ti ti-settings"></i> {t('dashboard.superAdmin.quickActions.platformSettings')}
              </button>
              <button className="btn-sm" onClick={() => showSection('audit')}>
                <i className="ti ti-history"></i> {t('dashboard.superAdmin.quickActions.viewAuditLog')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
