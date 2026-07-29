import { useEffect } from 'react';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { AppDataProvider, useAppData } from './context/AppDataContext.jsx';
import { ModalProvider } from './context/ModalContext.jsx';
import { NavigationProvider, useNavigation, getSectionFromUrl } from './context/NavigationContext.jsx';
import PublicEntryScreen from './components/PublicEntryScreen.jsx';
import SetPasswordScreen from './components/SetPasswordScreen.jsx';
import BrandingSetupScreen from './components/BrandingSetupScreen.jsx';
import AppShell from './components/AppShell.jsx';
import ToastContainer from './components/ToastContainer.jsx';

function Gate() {
  const { authPhase, currentUser } = useAppData();
  const { replaceSection } = useNavigation();

  // Students land on their own Dashboard (announcements/fees/GPA/today's classes at a glance)
  // rather than the Catalog — Catalog is still one click away in the sidebar for when they
  // actually want to register. Only applies on a genuinely fresh login (no section in the URL
  // yet) — a page refresh mid-session already has ?section=... from a prior in-app navigation,
  // and should land back there instead of being bounced to the role default every time.
  useEffect(() => {
    if (authPhase === 'ready' && currentUser && !getSectionFromUrl()) {
      replaceSection(currentUser.role === 'advisor' ? 'advisees' : 'dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authPhase]);

  if (authPhase === 'setpw') return <SetPasswordScreen />;
  if (authPhase === 'branding-setup') return <BrandingSetupScreen />;
  if (authPhase === 'ready') return <AppShell />;
  return <PublicEntryScreen />; // 'checking' or 'login' — mirrors the original's auth-screen being visible by default
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppDataProvider>
          <ModalProvider>
            <NavigationProvider>
              <Gate />
              <ToastContainer />
            </NavigationProvider>
          </ModalProvider>
        </AppDataProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
