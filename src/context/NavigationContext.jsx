import { createContext, useContext, useState } from 'react';

const NavigationContext = createContext(null);

export function NavigationProvider({ children }) {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Optional payload alongside a section switch — e.g. { section: 'attendance', courseId: 12 } —
  // so a course quick action can jump to a page *and* preselect a course in one step. A page
  // reads this via useNavigation() and applies it itself; it isn't cleared automatically, so
  // consumers should key their effect on identity (e.g. courseId) rather than assume a one-shot fire.
  const [sectionFocus, setSectionFocus] = useState(null);

  /** Port of showSection(name, navEl) minus the DOM class-toggling — React just re-renders
      whichever page has activeSection === its own name, and closes the mobile sidebar. */
  function showSection(name, focus = null) {
    setActiveSection(name);
    setSidebarOpen(false);
    setSectionFocus(focus ? { section: name, ...focus } : null);
  }

  function toggleSidebar(force) {
    setSidebarOpen(prev => (force !== undefined ? force : !prev));
  }

  const value = { activeSection, setActiveSection, showSection, sidebarOpen, toggleSidebar, sectionFocus };
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within a NavigationProvider');
  return ctx;
}
