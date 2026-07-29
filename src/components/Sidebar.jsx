import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import TermDropdown from './TermDropdown.jsx';
import { initials } from '../utils.js';
import { can } from '../permissions.js';
import { roleLabel } from '../roleNames.js';

// Staff-role navigation, driven by the central permission policy: each item
// declares the module it needs, and is shown only if the current role can read
// that module. Adding or re-scoping a role never touches this file — the policy
// decides. Faculty and student keep their own hand-built navs below (their
// access is per-object ownership / self, not module-level).
const STAFF_NAV = [
  { key: 'overview', items: [
    { name: 'dashboard', icon: 'ti-layout-dashboard', label: 'dashboard', module: 'dashboard' },
    { name: 'reports', icon: 'ti-chart-bar', label: 'reports', module: 'reports' },
  ] },
  { key: 'scheduling', items: [
    { name: 'timetable', icon: 'ti-calendar-week', label: 'timetable', module: 'timetable' },
    { name: 'rooms', icon: 'ti-door', label: 'rooms', module: 'rooms' },
    { name: 'courses', icon: 'ti-book', label: 'courses', module: 'courses' },
    { name: 'teachers', icon: 'ti-user', label: 'teachers', module: 'teachers' },
    { name: 'departments', icon: 'ti-building-community', label: 'departments', module: 'departments' },
    { name: 'semesters', icon: 'ti-calendar-time', label: 'semesters', module: 'terms' },
  ] },
  { key: 'exams', items: [
    { name: 'exams', icon: 'ti-writing', label: 'examSchedule', module: 'exams' },
    { name: 'enrollment', icon: 'ti-users', label: 'enrollment', module: 'enrollment' },
    { name: 'attendance', icon: 'ti-clipboard-check', label: 'attendance', module: 'attendance' },
    { name: 'gradebook', icon: 'ti-report-analytics', label: 'gradebook', module: 'grades' },
  ] },
  { key: 'admissions', items: [
    { name: 'applications', icon: 'ti-clipboard-list', label: 'admissions', module: 'admissions' },
  ] },
  { key: 'finance', items: [
    { name: 'finance', icon: 'ti-cash', label: 'finance', module: 'finance' },
  ] },
  { key: 'system', items: [
    { name: 'conflicts', icon: 'ti-alert-triangle', label: 'conflicts', module: 'conflicts', badge: true },
    { name: 'users', icon: 'ti-users-group', label: 'users', module: 'users' },
    { name: 'audit', icon: 'ti-history', label: 'auditLog', module: 'audit' },
    { name: 'backup', icon: 'ti-database-export', label: 'backup', module: 'backup' },
    { name: 'branding', icon: 'ti-palette', label: 'branding', module: 'branding' },
    { name: 'grading-scale', icon: 'ti-adjustments', label: 'gradingScale', module: 'gradingScale' },
  ] },
];

function NavItem({ name, icon, label, badge }) {
  const { activeSection, showSection } = useNavigation();
  return (
    <button className={'nav-item' + (activeSection === name ? ' active' : '')} onClick={() => showSection(name)}>
      <i className={'ti ' + icon} aria-hidden="true"></i> {label}
      {badge}
    </button>
  );
}

/** Renders the staff nav for any role that isn't faculty/student, filtering
    every item and section through the permission policy. */
function StaffNav({ role, t, conflictCount }) {
  return (
    <div id="nav-staff">
      {STAFF_NAV.map(section => {
        const items = section.items.filter(it => can(role, it.module, 'read'));
        if (!items.length) return null;
        return (
          <div className="nav-section" key={section.key}>
            <div className="nav-label">{t(`shell:sidebar.sections.${section.key}`)}</div>
            {items.map(it => (
              <NavItem
                key={it.name}
                name={it.name}
                icon={it.icon}
                label={t(`shell:sidebar.nav.${it.label}`)}
                badge={it.badge ? <span className="nav-badge">{conflictCount}</span> : undefined}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function Sidebar() {
  const { t } = useTranslation(['shell', 'common']);
  const { currentUser, conflictsData, terms, activeTermId, logout, branding, logoUrl } = useAppData();
  const { openModal } = useModal();
  const role = currentUser.role;
  const activeTerm = terms.find(t => t.id === activeTermId);
  const userInitials = initials(currentUser.name || currentUser.email);
  const conflictCount = conflictsData.critical.length + conflictsData.warnings.length;

  return (
    <aside id="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo">
          <div className="brand-icon">
            {logoUrl ? <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
              : branding.orgName ? initials(branding.orgName)
              : <i className="ti ti-school" aria-hidden="true"></i>}
          </div>
          <span className="brand-name">{branding.orgName || t('common:appName')}</span>
        </div>
        <div className="brand-sub">{activeTerm ? activeTerm.name : t('shell:sidebar.noTermsYet')}</div>
      </div>

      <TermDropdown />

      <nav>
        {role !== 'faculty' && role !== 'student' && role !== 'advisor' && (
          <StaffNav role={role} t={t} conflictCount={conflictCount} />
        )}

        {role === 'advisor' && (
          <div id="nav-advisor">
            <div className="nav-section">
              <div className="nav-label">{t('shell:sidebar.sections.overview')}</div>
              <NavItem name="dashboard" icon="ti-layout-dashboard" label={t('shell:sidebar.nav.dashboard')} />
              <NavItem name="advisees" icon="ti-users" label={t('shell:sidebar.nav.advisees')} />
            </div>
          </div>
        )}

        {role === 'faculty' && (
          <div id="nav-faculty">
            <div className="nav-section">
              <div className="nav-label">{t('shell:sidebar.sections.overview')}</div>
              <NavItem name="dashboard" icon="ti-layout-dashboard" label={t('shell:sidebar.nav.dashboard')} />
            </div>
            <div className="nav-section">
              <div className="nav-label">{t('shell:sidebar.sections.myTeaching')}</div>
              <NavItem name="timetable" icon="ti-calendar-week" label={t('shell:sidebar.nav.timetable')} />
              <NavItem name="courses" icon="ti-book" label={t('shell:sidebar.nav.myCourses')} />
              <NavItem name="exams" icon="ti-writing" label={t('shell:sidebar.nav.examSchedule')} />
              <NavItem name="enrollment" icon="ti-users" label={t('shell:sidebar.nav.enrollment')} />
              <NavItem name="attendance" icon="ti-clipboard-check" label={t('shell:sidebar.nav.attendance')} />
              <NavItem name="gradebook" icon="ti-report-analytics" label={t('shell:sidebar.nav.gradebook')} />
            </div>
          </div>
        )}

        {role === 'student' && (
          <div id="nav-student">
            <div className="nav-section">
              <div className="nav-label">{t('shell:sidebar.sections.courses')}</div>
              <NavItem name="student-profile" icon="ti-id-badge-2" label={t('shell:sidebar.nav.myProfile')} />
              <NavItem name="catalog" icon="ti-book" label={t('shell:sidebar.nav.catalog')} />
              <NavItem name="myschedule" icon="ti-calendar-week" label={t('shell:sidebar.nav.mySchedule')} />
              <NavItem name="my-attendance" icon="ti-clipboard-check" label={t('shell:sidebar.nav.myAttendance')} />
              <NavItem name="mygrades" icon="ti-report-analytics" label={t('shell:sidebar.nav.myGrades')} />
              <NavItem name="my-fees" icon="ti-cash" label={t('shell:sidebar.nav.myFees')} />
            </div>
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <button className="footer-profile-btn" onClick={() => openModal('profile')} title={t('common:actions.viewProfile')} aria-label={t('common:actions.viewProfile')}>
          <div className="avatar-sm">{userInitials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="footer-name">{currentUser.name || currentUser.email}</div>
            <div className="footer-role">
              {roleLabel(role, t, branding)}
              {currentUser.idNumber && <span className="footer-id"> · {currentUser.idNumber}</span>}
            </div>
          </div>
        </button>
        <button className="icon-btn" title={t('common:actions.logOut')} aria-label={t('common:actions.logOut')} onClick={logout}>
          <i className="ti ti-logout" aria-hidden="true"></i>
        </button>
      </div>
    </aside>
  );
}
