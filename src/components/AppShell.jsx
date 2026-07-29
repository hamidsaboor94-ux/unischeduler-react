import { useEffect, useState } from 'react';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import Sidebar from './Sidebar.jsx';
import UtilityTray from './UtilityTray.jsx';
import ModalHost from './modal/ModalHost.jsx';
import DashboardPage from '../pages/DashboardPage.jsx';
import ReportsPage from '../pages/ReportsPage.jsx';
import TimetablePage from '../pages/TimetablePage.jsx';
import ExamsPage from '../pages/ExamsPage.jsx';
import EnrollmentPage from '../pages/EnrollmentPage.jsx';
import ConflictsPage from '../pages/ConflictsPage.jsx';
import RoomsPage from '../pages/RoomsPage.jsx';
import CoursesPage from '../pages/CoursesPage.jsx';
import TeachersPage from '../pages/TeachersPage.jsx';
import DepartmentsPage from '../pages/DepartmentsPage.jsx';
import SemestersPage from '../pages/SemestersPage.jsx';
import UsersPage from '../pages/UsersPage.jsx';
import AuditLogPage from '../pages/AuditLogPage.jsx';
import BackupPage from '../pages/BackupPage.jsx';
import CatalogPage from '../pages/CatalogPage.jsx';
import MySchedulePage from '../pages/MySchedulePage.jsx';
import AttendancePage from '../pages/AttendancePage.jsx';
import MyAttendancePage from '../pages/MyAttendancePage.jsx';
import GradebookPage from '../pages/GradebookPage.jsx';
import MyGradesPage from '../pages/MyGradesPage.jsx';
import BrandingSettingsPage from '../pages/BrandingSettingsPage.jsx';
import GradingScalePage from '../pages/GradingScalePage.jsx';
import StudentProfilePage from '../pages/StudentProfilePage.jsx';
import ApplicationsPage from '../pages/ApplicationsPage.jsx';
import AdviseesPage from '../pages/AdviseesPage.jsx';
import FinancePage from '../pages/FinancePage.jsx';
import MyFeesPage from '../pages/MyFeesPage.jsx';

export default function AppShell() {
  const { isLoading } = useAppData();
  const { sidebarOpen, toggleSidebar } = useNavigation();

  // Port of showLoadingBar()/hideLoadingBar() — the key remount forces the width transition to
  // restart from 0 on every load rather than silently no-op'ing if it was already mid-transition.
  const [barState, setBarState] = useState('');
  const [barKey, setBarKey] = useState(0);
  useEffect(() => {
    if (isLoading) { setBarKey(k => k + 1); setBarState('active'); }
    else { setBarState('done'); }
  }, [isLoading]);

  return (
    <div id="app-wrapper">
      <div key={barKey} id="loading-bar" className={barState}></div>
      <div id="app" className={sidebarOpen ? 'sidebar-open' : ''}>
        <button id="sidebar-toggle" aria-label="Toggle navigation menu" onClick={() => toggleSidebar()}>
          <i className="ti ti-menu-2" aria-hidden="true"></i>
        </button>
        <div id="sidebar-overlay" onClick={() => toggleSidebar(false)}></div>

        <Sidebar />

        <div id="main">
          <DashboardPage />
          <ReportsPage />
          <TimetablePage />
          <ExamsPage />
          <EnrollmentPage />
          <ConflictsPage />
          <RoomsPage />
          <CoursesPage />
          <TeachersPage />
          <DepartmentsPage />
          <SemestersPage />
          <UsersPage />
          <AuditLogPage />
          <BackupPage />
          <CatalogPage />
          <MySchedulePage />
          <AttendancePage />
          <MyAttendancePage />
          <GradebookPage />
          <MyGradesPage />
          <BrandingSettingsPage />
          <GradingScalePage />
          <StudentProfilePage />
          <ApplicationsPage />
          <AdviseesPage />
          <FinancePage />
          <MyFeesPage />
        </div>
      </div>

      <UtilityTray />
      <ModalHost />
    </div>
  );
}
