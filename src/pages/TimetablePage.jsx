import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import WeeklyCalendar from '../components/WeeklyCalendar.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { apiUpload } from '../api.js';
import { DAYS, courseById, slotSession, mondayOf, weekDatesFrom, fmtDate } from '../utils.js';

/** A single filter dropdown with a small leading icon that names what it controls, so the row of
    chips reads at a glance without spelling out a text label on each. `active` marks a filter that
    is currently narrowing the view (a non-default value) with a subtle accent. */
function FilterChip({ icon, active = false, children }) {
  return (
    <span className={'filter-chip' + (active ? ' is-active' : '')}>
      <i className={'ti ' + icon + ' filter-chip-icon'} aria-hidden="true"></i>
      {children}
    </span>
  );
}

export default function TimetablePage() {
  const { t } = useTranslation(['timetable', 'common']);
  const { currentUser, courses, slots, slotExceptions, departments, conflictsData, activeTermId } = useAppData();
  const { openModal } = useModal();
  const { toast } = useToast();

  const isAdmin = currentUser.role === 'admin';
  const isFaculty = currentUser.role === 'faculty';

  // null = not yet chosen; re-derived below whenever the previous selection becomes invalid.
  const [ttSemesterFilter, setTtSemesterFilter] = useState(null);
  const [ttSectionFilter, setTtSectionFilter] = useState(null);
  const [ttSessionFilter, setTtSessionFilter] = useState('');
  const [ttDeptFilter, setTtDeptFilter] = useState('');
  const [ttDayFilter, setTtDayFilter] = useState('');
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);

  // Import/Reset live in a "⋯" overflow menu so they stop competing with the primary Add action.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    function onDocClick(e) {
      if (moreRef.current && moreOpen && !moreRef.current.contains(e.target)) setMoreOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [moreOpen]);

  // 0 = the current week; ±1 steps a week either way. Real dates in the day
  // headers let one-off cancellations/moves show on the specific week they hit.
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDates = useMemo(() => {
    const monday = mondayOf(new Date());
    monday.setDate(monday.getDate() + weekOffset * 7);
    return weekDatesFrom(monday);
  }, [weekOffset]);

  // #content re-renders in place on a week change (no remount), unlike an ordinary sidebar
  // switch — so unlike .section's built-in animation restart, this has to be re-triggered by
  // hand: clear both directional classes, force a reflow so the browser commits that removal,
  // then add the one matching the arrow pressed. Cleans itself up on animationend so a stale
  // class never lingers to override the plain "slide from right" used when re-entering this
  // page from the sidebar (see .section.active > #content in style.css).
  const contentRef = useRef(null);
  function triggerWeekSlide(direction) {
    const el = contentRef.current;
    if (!el) return;
    const cls = direction === 'next' ? 'week-slide-right' : 'week-slide-left';
    el.classList.remove('week-slide-right', 'week-slide-left');
    void el.offsetWidth; // force reflow — commits the removal before the class is re-added
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }

  // 'all' always leads — it's the default, all-inclusive option (no semester filter applied at
  // all), distinct from 'none' (filters FOR slots whose semester is unassigned, kept as its own
  // option since it's a genuinely different query some admins rely on for data hygiene).
  const semesterOptions = useMemo(() => {
    const semesterValues = [...new Set(slots.map(s => s.programSemester))];
    const numericSemesters = semesterValues.filter(v => v != null).sort((a, b) => a - b).map(String);
    const hasUnassigned = semesterValues.some(v => v == null);
    return ['all', ...numericSemesters, ...(hasUnassigned ? ['none'] : [])];
  }, [slots]);

  useEffect(() => {
    if (!semesterOptions.includes(ttSemesterFilter)) setTtSemesterFilter(semesterOptions[0] || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesterOptions]);

  const sectionsForSemester = useMemo(() => {
    return [...new Set(
      slots.filter(s => ttSemesterFilter === 'none' ? s.programSemester == null : String(s.programSemester) === ttSemesterFilter).map(s => s.section)
    )].filter(Boolean).sort();
  }, [slots, ttSemesterFilter]);

  useEffect(() => {
    if (!sectionsForSemester.includes(ttSectionFilter)) setTtSectionFilter(sectionsForSemester[0] || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsForSemester]);

  function handleSemesterChange(value) {
    setTtSemesterFilter(value || null);
    setTtSectionFilter(null); // re-derive the default section for the newly chosen semester
  }

  const conflictSlotIds = useMemo(() => new Set(
    conflictsData.critical
      .filter(c => c.type === 'room-double-booking' || c.type === 'instructor-double-booking')
      .flatMap(c => c.slotIds)
  ), [conflictsData]);

  // Every issue type with a detail view (mirrors ConflictItem.jsx's hasDetailView) mapped back
  // to the slot(s) it involves, so a course card's Conflicts quick-action can jump straight to
  // openModal('conflict-detail', ..., { issue }) instead of just showing a bare warning icon.
  const DETAIL_VIEW_TYPES = new Set(['room-double-booking', 'instructor-double-booking', 'duplicate-slot', 'moved-session-room-clash', 'moved-session-instructor-clash']);
  const conflictIssueBySlotId = useMemo(() => {
    const map = new Map();
    conflictsData.critical
      .filter(c => DETAIL_VIEW_TYPES.has(c.type))
      .forEach(issue => (issue.slotIds || []).forEach(id => { if (!map.has(id)) map.set(id, issue); }));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictsData]);

  let filtered = slots;
  const addPrefill = {};
  if (isFaculty) {
    // A lecturer teaches across many program semesters/sections at once — narrowing to a single
    // semester+section (like the admin view below does) would hide most of their own classes.
  } else {
    filtered = (ttSemesterFilter == null || ttSemesterFilter === 'all') ? slots
      : slots.filter(s => ttSemesterFilter === 'none' ? s.programSemester == null : String(s.programSemester) === ttSemesterFilter);
    if (ttSectionFilter) filtered = filtered.filter(s => s.section === ttSectionFilter);
    if (ttDeptFilter) filtered = filtered.filter(s => String(courseById(courses, s.courseId)?.departmentId) === ttDeptFilter);
    if (ttSemesterFilter && ttSemesterFilter !== 'none' && ttSemesterFilter !== 'all') addPrefill.programSemester = Number(ttSemesterFilter);
    if (ttSectionFilter) addPrefill.section = ttSectionFilter;
  }
  if (ttSessionFilter) filtered = filtered.filter(s => slotSession(s.time) === ttSessionFilter);

  // Faculty never get a semester filter (they teach across many at once, see the comment above),
  // so their view is permanently "all semesters" — group it the same way admin's "All semesters"
  // option does. For admin, only the explicit "all" selection groups; picking a specific semester
  // (or the "no semester set" bucket) stays a single ungrouped grid, same as before this feature.
  const groupBySemester = isFaculty || ttSemesterFilter == null || ttSemesterFilter === 'all';

  function ttSemesterLabel() {
    if (ttSemesterFilter == null || ttSemesterFilter === 'all') return t('timetable:timetablePage.allSemesters');
    return ttSemesterFilter === 'none'
      ? t('timetable:timetablePage.noSemesterClassesLabel')
      : t('timetable:timetablePage.semesterScopeLabel', { n: ttSemesterFilter });
  }

  // Reset Timetable always deletes a specific, named scope (one semester, or the unassigned
  // bucket) — deliberately kept that way even now that "All semesters" is a selectable (and
  // default) filter value, so this destructive action can never silently target the entire
  // timetable just because that's the current display filter. An admin who wants to reset
  // everything must pick each scope explicitly, same as before this change.
  function openResetTimetableModalHandler() {
    if (ttSemesterFilter == null || ttSemesterFilter === 'all') {
      toast(t('timetable:timetablePage.toasts.selectSpecificSemesterToReset'), 'warning');
      return;
    }
    const scopeSlots = slots.filter(s => ttSemesterFilter === 'none' ? s.programSemester == null : String(s.programSemester) === ttSemesterFilter);
    if (!scopeSlots.length) { toast(t('timetable:timetablePage.toasts.noEntriesToReset'), 'warning'); return; }
    openModal('reset-timetable-confirm', null, {
      scopeCount: scopeSlots.length,
      label: ttSemesterLabel(),
      programSemester: ttSemesterFilter === 'none' ? null : Number(ttSemesterFilter),
    });
  }

  async function handlePdfImportFile(file) {
    if (!file) return;
    if (!activeTermId) { toast(t('timetable:timetablePage.toasts.selectSemesterBeforeImport'), 'warning'); return; }
    setImporting(true);
    try {
      const result = await apiUpload('/timetable-import/parse', 'pdf', file);
      if (!result.rows.length) { toast(t('timetable:timetablePage.toasts.noClassesInPdf'), 'warning'); return; }
      openModal('pdf-import-preview', null, {
        rows: result.rows.map(r => ({ ...r })),
        warnings: result.warnings || [],
        emailDomain: result.defaultEmailDomain || 'faculty.local',
      });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Section name="timetable">
      <div className="topbar">
        <i className="ti ti-calendar-week" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2 className="topbar-title">{t('timetable:timetablePage.title')}</h2>
        <div className="week-nav">
          <button className="icon-btn" aria-label={t('timetable:timetablePage.prevWeek')} onClick={() => { setWeekOffset(o => o - 1); triggerWeekSlide('prev'); }}>
            <i className="ti ti-chevron-left" aria-hidden="true"></i>
          </button>
          <span className="week-nav-label">
            {fmtDate(weekDates.Mon)} – {fmtDate(weekDates.Sun)}
            {weekOffset === 0 && <span className="pill pill-blue" style={{ marginInlineStart: 6 }}>{t('timetable:timetablePage.thisWeek')}</span>}
          </span>
          <button className="icon-btn" aria-label={t('timetable:timetablePage.nextWeek')} onClick={() => { setWeekOffset(o => o + 1); triggerWeekSlide('next'); }}>
            <i className="ti ti-chevron-right" aria-hidden="true"></i>
          </button>
          {weekOffset !== 0 && <button className="btn-sm" onClick={() => setWeekOffset(0)}>{t('timetable:timetablePage.today')}</button>}
        </div>
        <div className="topbar-filters">
          {isAdmin && (
            <FilterChip icon="ti-building-community" active={!!ttDeptFilter}>
              <select className="select-sm" aria-label={t('timetable:timetablePage.filterDepartment')} value={ttDeptFilter} onChange={e => setTtDeptFilter(e.target.value)}>
                <option value="">{t('timetable:timetablePage.allDepartments')}</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </FilterChip>
          )}
          {isAdmin && (
            <FilterChip icon="ti-calendar-time">
              <select className="select-sm" aria-label={t('timetable:timetablePage.filterSemester')} value={ttSemesterFilter ?? ''} onChange={e => handleSemesterChange(e.target.value)}>
                {slots.length
                  ? semesterOptions.map(v => (
                    <option key={v} value={v}>
                      {v === 'all' ? t('timetable:timetablePage.allSemesters')
                        : v === 'none' ? t('timetable:timetablePage.noSemesterSet')
                        : t('timetable:timetablePage.semesterOption', { n: v })}
                    </option>
                  ))
                  : <option value="">{t('timetable:timetablePage.noClassesYet')}</option>}
              </select>
            </FilterChip>
          )}
          {isAdmin && (
            <FilterChip icon="ti-users-group">
              <select className="select-sm" aria-label={t('timetable:timetablePage.filterSection')} value={ttSectionFilter ?? ''} onChange={e => setTtSectionFilter(e.target.value || null)}>
                {sectionsForSemester.length
                  ? sectionsForSemester.map(sec => <option key={sec} value={sec}>{t('timetable:timetablePage.sectionOption', { sec })}</option>)
                  : <option value="">{t('timetable:timetablePage.noSectionSet')}</option>}
              </select>
            </FilterChip>
          )}
          <FilterChip icon="ti-sun" active={!!ttSessionFilter}>
            <select className="select-sm" aria-label={t('timetable:timetablePage.filterSession')} value={ttSessionFilter} onChange={e => setTtSessionFilter(e.target.value)}>
              <option value="">{t('timetable:timetablePage.allSessions')}</option>
              <option value="Morning">{t('timetable:timetablePage.morning')}</option>
              <option value="Evening">{t('timetable:timetablePage.evening')}</option>
            </select>
          </FilterChip>
          <FilterChip icon="ti-calendar-event" active={!!ttDayFilter}>
            <select className="select-sm" aria-label={t('timetable:timetablePage.filterDay')} value={ttDayFilter} onChange={e => setTtDayFilter(e.target.value)}>
              <option value="">{t('timetable:timetablePage.allDays')}</option>
              {DAYS.map(d => <option key={d} value={d}>{t('common:days.' + d)}</option>)}
            </select>
          </FilterChip>
        </div>
        <div className="topbar-spacer"></div>
        {isAdmin && (
          <div className="topbar-actions">
            <input
              type="file" ref={fileInputRef} accept=".pdf" style={{ display: 'none' }}
              onChange={e => { handlePdfImportFile(e.target.files[0]); e.target.value = ''; }}
            />
            <button className="btn-primary" onClick={() => openModal('slot', null, addPrefill)}><i className="ti ti-plus"></i> {t('timetable:timetablePage.addSlot')}</button>
            <div className="tt-more" ref={moreRef}>
              <button
                className="icon-btn"
                aria-label={t('timetable:timetablePage.moreActions')}
                aria-haspopup="true"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(o => !o)}
              >
                {importing ? <span className="spinner"></span> : <i className="ti ti-dots" aria-hidden="true"></i>}
              </button>
              {moreOpen && (
                <div className="tt-more-menu" role="menu">
                  <button
                    className="tt-more-item" role="menuitem" disabled={importing}
                    onClick={() => { setMoreOpen(false); fileInputRef.current?.click(); }}
                  >
                    <i className="ti ti-file-upload" aria-hidden="true"></i> {t('timetable:timetablePage.importFromPdf')}
                  </button>
                  <button
                    className="tt-more-item" role="menuitem"
                    onClick={() => { setMoreOpen(false); openResetTimetableModalHandler(); }}
                  >
                    <i className="ti ti-trash" aria-hidden="true"></i> {t('timetable:timetablePage.resetTimetableButton')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div id="content" className="cal-content" ref={contentRef}>
        <WeeklyCalendar
          slotsToShow={filtered}
          conflictSlotIds={conflictSlotIds}
          editable={isAdmin}
          addable={isAdmin}
          showLecturer={!isFaculty}
          showSemesterBadge={false}
          addPrefill={addPrefill}
          dayFilter={ttDayFilter}
          weekDates={weekDates}
          exceptions={slotExceptions}
          onCardClick={isFaculty ? (course) => openModal('course-actions', course.id) : undefined}
          conflictIssueBySlotId={conflictIssueBySlotId}
          groupBySemester={groupBySemester}
        />
      </div>
    </Section>
  );
}
