import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, markNotificationRead, markAllNotificationsRead, updateMyLanguage, fetchActivityStatus, markCourseActivityViewedApi, fetchMyGrades, fetchTeacherProfileSummaries } from '../api.js';
import { API_BASE } from '../api.js';
import { useToast } from './ToastContext.jsx';
import { lightenHex, hexToRgba } from '../utils.js';
import { applyLanguage, DEFAULT_LANGUAGE } from '../i18n/index.js';
import { can } from '../permissions.js';
import { getToken, clearToken } from '../tokenStorage.js';

const AppDataContext = createContext(null);

const emptyConflicts = { critical: [], warnings: [], notices: [] };
const emptyBranding = { orgName: null, brandColor: null, hasLogo: false, logoVersion: '0' };

/** Applies an admin-picked brand color to the CSS custom properties every accent-colored
    element already reads from (--accent / --accent-light / --accent-dim in style.css) —
    no component needs to know branding exists, they just keep using the same variables. */
function applyBrandColor(hex) {
  const root = document.documentElement.style;
  if (!hex) {
    root.removeProperty('--accent');
    root.removeProperty('--accent-light');
    root.removeProperty('--accent-dim');
    return;
  }
  root.setProperty('--accent', hex);
  root.setProperty('--accent-light', lightenHex(hex, 0.2));
  root.setProperty('--accent-dim', hexToRgba(hex, 0.15));
}

export function AppDataProvider({ children }) {
  const { toast } = useToast();

  // 'checking' | 'login' | 'setpw' | 'branding-setup' | 'ready'
  const [authPhase, setAuthPhase] = useState('checking');
  const [currentUser, setCurrentUser] = useState(null);
  const [branding, setBranding] = useState(emptyBranding);
  const [language, setLanguageState] = useState(DEFAULT_LANGUAGE);

  const [departments, setDepartments] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [studentTypes, setStudentTypes] = useState([]);
  const [terms, setTerms] = useState([]);
  const [activeTermId, setActiveTermIdState] = useState(null);
  const [teachers, setTeachers] = useState([]);
  // teacherId -> { employeeId, designation, employmentType, status, completionPercent,
  // profileStatus, documentsCount, verifiedDocumentsCount } — one bulk fetch backing the Teacher
  // Management list's status badges/filters instead of a per-row profile request.
  const [teacherProfileSummaries, setTeacherProfileSummaries] = useState(new Map());
  const [rooms, setRooms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [slots, setSlots] = useState([]);
  const [slotExceptions, setSlotExceptions] = useState([]);
  const [exams, setExams] = useState([]);
  const [myEnrollments, setMyEnrollments] = useState([]);
  const [conflictsData, setConflictsData] = useState(emptyConflicts);
  // Detailed per-conflict results from the last successful "Auto-resolve" run — the Conflicts
  // page's "Recently resolved" panel reads this. Lives here rather than local component state
  // because auto-resolve can be triggered from more than one place (the page's own toolbar
  // button, or a ConflictItem card's "Suggest fix" action), and both should update the same panel.
  const [lastResolutions, setLastResolutions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  useEffect(()=>{
    if(!currentUser)return undefined;
    let cancelled=false;
    const poll=async()=>{try{const rows=await api('GET','/notifications');if(!cancelled)setNotifications(rows);}catch{/* next poll retries */}};
    const timer=setInterval(poll,30000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[currentUser]);
  const [unviewedActivityCourseIds, setUnviewedActivityCourseIds] = useState(new Set());
  // courseId -> count of unseen assignments/announcements/materials — Map<number, number>, same
  // source (GET /course-activity/status) as unviewedActivityCourseIds, just the count alongside
  // the existing boolean set rather than replacing it (nothing else needs to change).
  const [unviewedActivityCounts, setUnviewedActivityCounts] = useState(new Map());
  const [myFinalGrades, setMyFinalGrades] = useState(new Map());
  const [courseRosters, setCourseRosters] = useState(new Map());
  const [allUsers, setAllUsers] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // tableName -> { key, dir: 1 | -1 } — global (not per-page) so a table's sort survives navigating away and back
  const [sortState, setSortState] = useState({});
  const toggleSort = (table, key) => {
    setSortState(prev => {
      const s = prev[table] || { key: null, dir: 1 };
      const next = s.key === key ? { key, dir: s.dir * -1 } : { key, dir: 1 };
      return { ...prev, [table]: next };
    });
  };

  /** Core data load, parameterized on user/termId so callers can pass values that
      haven't committed to state yet (avoids stale-closure races around login/term-switch). */
  async function performLoad(user, termIdParam) {
    setIsLoading(true);
    try {
      const role = user.role;
      // Every fetch below is gated by the same central policy the backend
      // enforces, so each role only loads what it may see — a role with no
      // timetable access never requests slots, etc. Reference data
      // (departments/teachers/rooms) is readable by anyone for display.
      const wantCourses = can(role, 'courses', 'read');
      const wantTimetable = can(role, 'timetable', 'read');
      const wantExams = can(role, 'exams', 'read');
      // Mirrors the backend's GET /teacher-profile guard (teachers:View OR finance:write/Bursar) —
      // a role without either (e.g. student, faculty) 403s on this call. Left ungated, that 403
      // rejects the Promise.all below and silently aborts the rest of this load (courses, rooms,
      // slots, exams, notifications all stay stuck at their initial empty state) with no visible
      // error, since AuthScreen's try/catch around boot() fires after the UI has already left the
      // login screen.
      const wantTeacherProfiles = can(role, 'teachers', 'read') || can(role, 'finance', 'write');

      const [depts, clgs, progs, sTypes, trms] = await Promise.all([
        api('GET', '/departments'), api('GET', '/colleges'), api('GET', '/programs'), api('GET', '/student-types'), api('GET', '/terms'),
      ]);
      setDepartments(depts);
      setColleges(clgs);
      setPrograms(progs);
      setStudentTypes(sTypes);
      setTerms(trms);

      let effectiveTermId = termIdParam;
      if (effectiveTermId == null || !trms.some(t => t.id === effectiveTermId)) {
        const active = trms.find(t => t.isActive) || trms[0];
        effectiveTermId = active ? active.id : null;
      }
      setActiveTermIdState(effectiveTermId);

      const termQuery = effectiveTermId ? `?termId=${effectiveTermId}` : '';
      const [tchrs, profileSummaries, rms, crs, slts, exms, excs, notifs] = await Promise.all([
        api('GET', '/teachers'),
        wantTeacherProfiles ? fetchTeacherProfileSummaries() : Promise.resolve([]),
        api('GET', '/rooms'),
        wantCourses ? api('GET', `/courses${termQuery}`) : Promise.resolve([]),
        wantTimetable ? api('GET', '/slots').then(rows => effectiveTermId ? rows.filter(s => s.termId === effectiveTermId) : rows) : Promise.resolve([]),
        wantExams ? api('GET', `/exams${termQuery}`) : Promise.resolve([]),
        wantTimetable ? api('GET', '/slot-exceptions') : Promise.resolve([]),
        api('GET', '/notifications'),
      ]);
      setTeachers(tchrs);
      setTeacherProfileSummaries(new Map(profileSummaries.map(s => [s.teacherId, s])));
      setRooms(rms);
      setCourses(crs);
      setSlots(slts);
      setExams(exms);
      setSlotExceptions(excs);
      setNotifications(notifs);

      // Rosters are reachable only by roles that can manage a course (admin,
      // registrar, department head, and faculty for their own) — the course
      // list is already scoped, so every roster fetched here is permitted.
      if (role === 'faculty' || can(role, 'courses', 'write')) {
        const rosterMap = new Map();
        await Promise.all(crs.map(async c => {
          rosterMap.set(c.id, await api('GET', `/courses/${c.id}/roster`));
        }));
        setCourseRosters(rosterMap);
      }
      if (can(role, 'conflicts', 'read')) {
        setConflictsData(effectiveTermId ? await api('GET', `/conflicts?termId=${effectiveTermId}`) : emptyConflicts);
      }
      if (role === 'admin') {
        setAllUsers(await api('GET', '/users'));
      }
      if (can(role, 'audit', 'read')) {
        setAuditLog(await api('GET', '/audit-log'));
      }
      if (role === 'student') {
        setMyEnrollments(await api('GET', '/enrollments/me'));
        const { courseIds, counts } = await fetchActivityStatus();
        setUnviewedActivityCourseIds(new Set(courseIds));
        setUnviewedActivityCounts(new Map(Object.entries(counts).map(([id, n]) => [Number(id), n])));
        const grades = await fetchMyGrades();
        setMyFinalGrades(new Map(grades.map(g => [g.course.id, { letterGrade: g.letterGrade, hasAnyScore: g.hasAnyScore, average: g.average }])));
      } else if (role === 'faculty') {
        setMyEnrollments(await api('GET', '/enrollments/me'));
      }
    } finally {
      setIsLoading(false);
    }
  }

  /** Reload everything for the current user/term — the React equivalent of loadAll(). */
  const reload = () => performLoad(currentUser, activeTermId);

  /** afterMutate(promise, message) — run a mutation, toast the result, then unconditionally reload. */
  async function afterMutate(promise, message) {
    try {
      await promise;
      if (message) toast(message);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      await reload();
    }
  }

  /** Marks one persisted notification read — optimistic locally (instant dismiss), backed by the
      API call (errors are non-fatal here; a stale unread flag on next reload isn't worth a toast). */
  async function dismissNotification(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: 1 } : n));
    try { await markNotificationRead(id); } catch (err) { /* not worth surfacing */ }
  }

  /** Same as above but for all of the current user's notifications — used when the bell panel opens. */
  async function dismissAllNotifications() {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: 1 })));
    try { await markAllNotificationsRead(); } catch (err) { /* not worth surfacing */ }
  }

  /** A student opening a course's activity card (assignments/announcements) — clears that
      course's "unviewed" dot immediately, both locally and server-side. Deliberately separate
      from dismissNotification: opening the bell mark-all-reads every notification, which would
      otherwise clear every course's badge the instant any one notification was seen. */
  async function markCourseActivityViewed(courseId) {
    setUnviewedActivityCourseIds(prev => {
      if (!prev.has(courseId)) return prev;
      const next = new Set(prev);
      next.delete(courseId);
      return next;
    });
    setUnviewedActivityCounts(prev => {
      if (!prev.has(courseId)) return prev;
      const next = new Map(prev);
      next.delete(courseId);
      return next;
    });
    try { await markCourseActivityViewedApi(courseId); } catch (err) { /* not worth surfacing */ }
  }

  /** Switch which term is being viewed and reload data scoped to it. */
  async function selectTerm(id) {
    setActiveTermIdState(id);
    await performLoad(currentUser, id);
  }

  /** Re-fetches branding — public endpoint, works whether or not anyone is logged in yet
      (the login screen needs it before authentication exists). Never throws: a fetch failure
      just leaves the previous (or default "UniScheduler") branding in place. */
  async function loadBranding() {
    try {
      const b = await api('GET', '/settings/branding');
      setBranding(b);
      return b;
    } catch {
      return branding;
    }
  }

  /** After a successful login/set-password response. An admin whose org has never configured
      branding (orgName unset) is routed to the one-time setup screen instead of the app itself —
      this is what "first run" means for this feature; everyone else goes straight to 'ready'
      with whatever branding (or default) is already configured. */
  async function boot(user) {
    setCurrentUser(user);
    applyLanguage(user.language || DEFAULT_LANGUAGE);
    setLanguageState(user.language || DEFAULT_LANGUAGE);
    const b = await loadBranding();
    if (user.role === 'admin' && !b.orgName) {
      setAuthPhase('branding-setup');
      return;
    }
    setAuthPhase('ready');
    await performLoad(user, activeTermId);
  }

  /** Called once the first-run branding screen (or a "skip" on it) has saved something —
      orgName is now set, so boot() will never route here again for this database. */
  async function completeBrandingSetup() {
    await loadBranding();
    setAuthPhase('ready');
    await performLoad(currentUser, activeTermId);
  }

  function showSetPasswordScreen() {
    setAuthPhase('setpw');
  }

  /** Applies a fresh copy of the logged-in user's own row (e.g. after editing name/email in
      the profile modal) so the sidebar and everywhere else reflects it immediately, without a
      full reload() — that also refetches term-scoped data, none of which changed here. */
  function updateCurrentUser(user) {
    setCurrentUser(user);
  }

  function logout() {
    clearToken();
    setCurrentUser(null);
    setActiveTermIdState(null);
    setAuthPhase('login');
    applyLanguage(DEFAULT_LANGUAGE);
    setLanguageState(DEFAULT_LANGUAGE);
    // Persisted, per-user notifications must never carry across accounts — the next boot()
    // (this login or the next one, same browser tab) always re-fetches its own scoped set,
    // but nothing from this account's feed should be visible even for the instant in between.
    setNotifications([]);
    setLastResolutions([]);
  }

  /** Self-service language switch — applied immediately (i18next + document dir/lang) so the
      UI mirrors right away, persisted to this account's row in the background, and mirrored onto
      currentUser so a reload picks up the same choice without waiting on a re-fetch. */
  async function changeLanguage(lang) {
    applyLanguage(lang);
    setLanguageState(lang);
    setCurrentUser(prev => prev ? { ...prev, language: lang } : prev);
    try {
      await updateMyLanguage(lang);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Branding needs to be visible on the login screen too, before any of the auth flow below
  // has run — fetched unconditionally and independently of it. Same for language/direction:
  // the login screen itself must render in the right direction before anyone has authenticated.
  useEffect(() => {
    loadBranding();
    applyLanguage(DEFAULT_LANGUAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the tab/window title and every --accent-* CSS variable in sync with whatever
  // branding is currently loaded — runs for every role, logged in or not.
  useEffect(() => {
    document.title = branding.orgName || 'UniScheduler';
    applyBrandColor(branding.brandColor);
  }, [branding]);

  const logoUrl = branding.hasLogo
    ? `${API_BASE}/settings/branding/logo?v=${branding.logoVersion}`
    : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getToken();
      if (!token) { setAuthPhase('login'); return; }
      try {
        const user = await api('GET', '/auth/me');
        if (cancelled) return;
        if (user.mustChangePassword) setAuthPhase('setpw');
        else await boot(user);
      } catch (err) {
        if (cancelled) return;
        clearToken();
        setAuthPhase('login');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({
    authPhase, currentUser, branding, logoUrl, language,
    departments, colleges, programs, studentTypes, terms, activeTermId, teachers, teacherProfileSummaries, rooms, courses, slots, slotExceptions, exams,
    myEnrollments, conflictsData, lastResolutions, setLastResolutions, courseRosters, allUsers, auditLog, isLoading, notifications,
    unviewedActivityCourseIds, unviewedActivityCounts, myFinalGrades,
    sortState, toggleSort,
    reload, afterMutate, selectTerm, boot, showSetPasswordScreen, logout,
    dismissNotification, dismissAllNotifications, markCourseActivityViewed, updateCurrentUser,
    loadBranding, completeBrandingSetup, changeLanguage,
    setActiveTermIdOptimistic: setActiveTermIdState,
  }), [
    authPhase, currentUser, branding, logoUrl, language,
    departments, colleges, programs, studentTypes, terms, activeTermId, teachers, teacherProfileSummaries, rooms, courses, slots, slotExceptions, exams,
    myEnrollments, conflictsData, lastResolutions, courseRosters, allUsers, auditLog, isLoading, notifications,
    unviewedActivityCourseIds, unviewedActivityCounts, myFinalGrades,
    sortState,
  ]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within an AppDataProvider');
  return ctx;
}
