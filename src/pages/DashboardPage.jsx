import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import SuperAdminDashboard from '../components/SuperAdminDashboard.jsx';
import StudentDashboard from '../components/StudentDashboard.jsx';
import RegistrarDashboard from '../components/RegistrarDashboard.jsx';
import BursarDashboard from '../components/BursarDashboard.jsx';
import FacultyDashboard from '../components/FacultyDashboard.jsx';
import GenericStaffDashboard from '../components/GenericStaffDashboard.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
// import { useAutoSchedule } from '../hooks/useSchedulingActions.js'; // unused now that the header's Auto-Schedule button is commented out below

// Central role -> landing-dashboard map. Adding a new role's dedicated dashboard (Faculty,
// Exam Officer, ...) is a new component file + one entry here — never a new branch scattered
// through this page. Any role not listed falls through to GenericStaffDashboard below.
const ROLE_DASHBOARDS = {
  admin: SuperAdminDashboard,
  student: StudentDashboard,
  registrar: RegistrarDashboard,
  bursar: BursarDashboard,
  faculty: FacultyDashboard,
};

// The cancelled-class notification only carries the slot id (entityId) — the affected date lives
// in slot_exceptions and, as free text, in this message ("...class on 2026-07-26 at..."). Matching
// on both slotId and that parsed date finds the exact slot_exceptions row the banner refers to,
// so clicking it opens the reschedule dialog for THAT session and no other.
const NOTICE_DATE_RE = / on (\d{4}-\d{2}-\d{2}) at /;
function cancelledExceptionForNotice(n, slotExceptions) {
  const match = n.message.match(NOTICE_DATE_RE);
  if (!match) return null;
  return slotExceptions.find(x => x.slotId === n.entityId && x.date === match[1] && x.kind === 'cancelled') || null;
}

export default function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'admissions', 'common']);
  const { currentUser, notifications, dismissNotification, slotExceptions } = useAppData();
  const { openModal } = useModal();
  // const { autoScheduleAll, loading } = useAutoSchedule(); // unused now that the header's Auto-Schedule button is commented out below

  const isAdmin = currentUser.role === 'admin';
  const RoleDashboard = ROLE_DASHBOARDS[currentUser.role] || null;

  // Class-status notices (cancelled/rescheduled) are keyed by the affected timetable slot
  // (entityId, see routes/slotExceptions.js) — grouped so a later reschedule notification
  // supersedes an earlier cancellation notice for the SAME class, showing only the newest one
  // instead of both piling up forever. Cancelled notices are never dismissable (they persist
  // until the class is actually rescheduled or restored); rescheduled ones use the normal
  // dismiss flow. Every other notification type is untouched — same as before this feature.
  const CLASS_STATUS_TYPES = new Set(['class_cancelled', 'class_rescheduled']);
  const latestClassStatusIdBySlot = new Map();
  notifications.forEach(n => {
    if (!CLASS_STATUS_TYPES.has(n.type)) return;
    const existing = latestClassStatusIdBySlot.get(n.entityId);
    if (!existing || new Date(n.createdAt) > new Date(existing.createdAt)) latestClassStatusIdBySlot.set(n.entityId, n);
  });
  const dashboardNotices = notifications.filter(n => {
    if (CLASS_STATUS_TYPES.has(n.type)) {
      if (latestClassStatusIdBySlot.get(n.entityId)?.id !== n.id) return false; // superseded by a newer notice for the same class
      return n.type === 'class_cancelled' || !n.isRead;
    }
    return !n.isRead;
  });

  return (
    <Section name="dashboard">
      <div className="topbar">
        <i className="ti ti-layout-dashboard" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('dashboard.title')}</h2>
        <div className="topbar-actions">
          {/* Dashboard is view-only oversight (Registrar owns edits) — New Course / Auto-Schedule
              live on their proper pages (Courses / Exams). Commented out, not deleted, for easy
              restore if that call ever changes.
          {isAdmin && (
            <button className="btn-sm" onClick={() => openModal('course')}><i className="ti ti-plus"></i> {t('dashboard.newCourse')}</button>
          )}
          {isAdmin && <div className="topbar-divider"></div>}
          {isAdmin && (
            <button className={'btn-gold' + (loading ? ' btn-loading' : '')} onClick={() => autoScheduleAll()} disabled={loading}>
              {loading ? <span className="spinner"></span> : <><i className="ti ti-wand"></i> {t('dashboard.autoSchedule')}</>}
            </button>
          )}
          */}
        </div>
      </div>
      <div id="content">
        {!isAdmin && dashboardNotices.length > 0 && (
          <div className="dash-notice-panel">
            {dashboardNotices.map(n => {
              const isRescheduled = n.type === 'class_rescheduled';
              const isCancelled = n.type === 'class_cancelled';
              // Only the faculty who teaches the class may act on a cancellation notice — students
              // see the exact same banner, read-only, same as before this feature.
              const cancelledException = isCancelled && currentUser.role === 'faculty'
                ? cancelledExceptionForNotice(n, slotExceptions)
                : null;
              const clickable = !!cancelledException;
              return (
                <div
                  className={'dash-notice' + (isRescheduled ? ' dash-notice-info' : '') + (clickable ? ' dash-notice-clickable' : '')}
                  key={n.id}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable ? t('dashboard.clickToReschedule') : undefined}
                  onClick={clickable ? () => openModal('reschedule-cancelled-session', cancelledException.id) : undefined}
                  onKeyDown={clickable ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal('reschedule-cancelled-session', cancelledException.id); }
                  } : undefined}
                >
                  <i className={'ti ' + (isRescheduled ? 'ti-calendar-check' : 'ti-calendar-off')} aria-hidden="true"></i>
                  <div className="dash-notice-msg">{n.message}</div>
                  {clickable && <i className="ti ti-chevron-right dash-notice-chevron" aria-hidden="true"></i>}
                  {isRescheduled && (
                    <button className="icon-btn" aria-label={t('dashboard.dismiss')} onClick={() => dismissNotification(n.id)}>
                      <i className="ti ti-x" aria-hidden="true"></i>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {RoleDashboard ? <RoleDashboard /> : <GenericStaffDashboard />}
      </div>
    </Section>
  );
}
