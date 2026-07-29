import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAppData } from './AppDataContext.jsx';
import { canAccessSection } from '../permissions.js';

const NavigationContext = createContext(null);

/** The only piece of navigation state that lives in the URL — the section itself. sectionFocus
    (e.g. { studentId: 12 }) rides along in the history entry's own state object instead, since
    it's an ad-hoc, page-specific payload, not something a shared/typed-in URL needs to reconstruct. */
function getSectionFromUrl() {
  return new URLSearchParams(window.location.search).get('section');
}

function urlForSection(name) {
  const params = new URLSearchParams(window.location.search);
  params.set('section', name);
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

export function NavigationProvider({ children }) {
  const [activeSection, setActiveSection] = useState(() => getSectionFromUrl() || 'dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Optional payload alongside a section switch — e.g. { section: 'attendance', courseId: 12 } —
  // so a course quick action can jump to a page *and* preselect a course in one step. A page
  // reads this via useNavigation() and applies it itself; it isn't cleared automatically, so
  // consumers should key their effect on identity (e.g. courseId) rather than assume a one-shot fire.
  const [sectionFocus, setSectionFocus] = useState(null);

  // Every section switch used to be pure React state — the browser never saw it, so it had no
  // in-app history to walk back through and Back left the site immediately. This seeds the
  // initial history entry with matching state (so the very first popstate has something to read)
  // and listens for Back/Forward to sync activeSection back without re-pushing (pushing here
  // would fight the browser's own history position).
  useEffect(() => {
    window.history.replaceState({ section: activeSection, sectionFocus }, '', urlForSection(activeSection));

    function onPopState(e) {
      if (!e.state?.section) return; // no in-app state left on this entry — let the browser navigate normally
      setActiveSection(e.state.section);
      setSectionFocus(e.state.sectionFocus ?? null);
      setSidebarOpen(false);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Port of showSection(name, navEl) minus the DOM class-toggling — React just re-renders
      whichever page has activeSection === its own name, and closes the mobile sidebar.
      Pushes a new browser history entry per navigation (skipped for a redundant click on the
      already-active section with no focus payload, so mashing the same sidebar item doesn't
      pile up dead Back steps) so Back/Forward walk through in-app views before ever leaving. */
  function showSection(name, focus = null) {
    if (currentUser && !canAccessSection(currentUser.role, name)) name = 'dashboard';
    if (name === activeSection && !focus) return;
    const payload = focus ? { section: name, ...focus } : null;
    window.history.pushState({ section: name, sectionFocus: payload }, '', urlForSection(name));
    setActiveSection(name);
    setSidebarOpen(false);
    setSectionFocus(payload);
  }

  /** Same as showSection but REPLACES the current history entry instead of pushing — for the
      one-time role-based landing redirect right after login/reload, which corrects *where* the
      current entry points rather than adding a new Back-able step (so Back doesn't bounce
      through a transient pre-login placeholder). */
  function replaceSection(name) {
    if (currentUser && !canAccessSection(currentUser.role, name)) name = 'dashboard';
    window.history.replaceState({ section: name, sectionFocus: null }, '', urlForSection(name));
    setActiveSection(name);
    setSectionFocus(null);
  }

  function toggleSidebar(force) {
    setSidebarOpen(prev => (force !== undefined ? force : !prev));
  }

  // A logged-out user's ?section=... would otherwise survive in the URL and, per replaceSection's
  // own "don't clobber a URL section" rule in App.jsx's Gate, silently skip the next login's
  // role-based landing redirect — e.g. faculty logs out on 'gradebook', a student logs in on the
  // same machine/tab and would incorrectly land back on 'gradebook' instead of 'myschedule'.
  const { currentUser } = useAppData();
  const wasLoggedIn = useRef(false);
  useEffect(() => {
    if (wasLoggedIn.current && !currentUser) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
      setActiveSection('dashboard');
      setSectionFocus(null);
    } else if (currentUser && !canAccessSection(currentUser.role, activeSection)) {
      // Covers a stale/spoofed ?section= surviving into this login (a page refresh mid-session,
      // or a shared browser where the previous user's role couldn't reach this section) — Gate's
      // own post-login redirect in App.jsx only fires when the URL had no section at all.
      replaceSection('dashboard');
    }
    wasLoggedIn.current = !!currentUser;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // setActiveSection itself is intentionally NOT exposed — every external navigation must go
  // through showSection/replaceSection so it stays in sync with browser history (that mismatch
  // is exactly what caused Back to leave the site instead of stepping through in-app views).
  const value = { activeSection, showSection, replaceSection, sidebarOpen, toggleSidebar, sectionFocus };
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within a NavigationProvider');
  return ctx;
}

export { getSectionFromUrl };
