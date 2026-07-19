import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import TermDropdown from './TermDropdown.jsx';
import { initials } from '../utils.js';

function NavItem({ name, icon, label, badge }) {
  const { activeSection, showSection } = useNavigation();
  return (
    <button className={'nav-item' + (activeSection === name ? ' active' : '')} onClick={() => showSection(name)}>
      <i className={'ti ' + icon} aria-hidden="true"></i> {label}
      {badge}
    </button>
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
        {role === 'admin' && (
          <div id="nav-admin">
            <div className="nav-section">
              <div className="nav-label">{t('shell:sidebar.sections.overview')}</div>
              <NavItem name="dashboard" icon="ti-layout-dashboard" label={t('shell:sidebar.nav.dashboard')} />
              <NavItem name="reports" icon="ti-chart-bar" label={t('shell:sidebar.nav.reports')} />
            </div>
            <div className="nav-section">
              <div className="nav-label">{t('shell:sidebar.sections.scheduling')}</div>
              <NavItem name="timetable" icon="ti-calendar-week" label={t('shell:sidebar.nav.timetable')} />
              <NavItem name="rooms" icon="ti-door" label={t('shell:sidebar.nav.rooms')} />
              <NavItem name="courses" icon="ti-book" label={t('shell:sidebar.nav.courses')} />
              <NavItem name="teachers" icon="ti-user" label={t('shell:sidebar.nav.teachers')} />
              <NavItem name="departments" icon="ti-building-community" label={t('shell:sidebar.nav.departments')} />
              <NavItem name="semesters" icon="ti-calendar-time" label={t('shell:sidebar.nav.semesters')} />
            </div>
            <div className="nav-section">
              <div className="nav-label">{t('shell:sidebar.sections.exams')}</div>
              <NavItem name="exams" icon="ti-writing" label={t('shell:sidebar.nav.examSchedule')} />
              <NavItem name="enrollment" icon="ti-users" label={t('shell:sidebar.nav.enrollment')} />
              <NavItem name="attendance" icon="ti-clipboard-check" label={t('shell:sidebar.nav.attendance')} />
              <NavItem name="gradebook" icon="ti-report-analytics" label={t('shell:sidebar.nav.gradebook')} />
            </div>
            <div className="nav-section">
              <div className="nav-label">{t('shell:sidebar.sections.admissions')}</div>
              <NavItem name="applications" icon="ti-clipboard-list" label={t('shell:sidebar.nav.admissions')} />
            </div>
            <div className="nav-section">
              <div className="nav-label">{t('shell:sidebar.sections.system')}</div>
              <NavItem name="conflicts" icon="ti-alert-triangle" label={t('shell:sidebar.nav.conflicts')} badge={<span className="nav-badge">{conflictCount}</span>} />
              <NavItem name="users" icon="ti-users-group" label={t('shell:sidebar.nav.users')} />
              <NavItem name="audit" icon="ti-history" label={t('shell:sidebar.nav.auditLog')} />
              <NavItem name="backup" icon="ti-database-export" label={t('shell:sidebar.nav.backup')} />
              <NavItem name="branding" icon="ti-palette" label={t('shell:sidebar.nav.branding')} />
              <NavItem name="grading-scale" icon="ti-adjustments" label={t('shell:sidebar.nav.gradingScale')} />
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
            </div>
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <button className="footer-profile-btn" onClick={() => openModal('profile')} title={t('common:actions.viewProfile')} aria-label={t('common:actions.viewProfile')}>
          <div className="avatar-sm">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="footer-name">{currentUser.name || currentUser.email}</div>
            <div className="footer-role">
              {t(`common:roles.${role}`)}
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
