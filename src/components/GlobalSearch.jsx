import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { departmentName } from '../utils.js';

const MAX_RESULTS_PER_GROUP = 5;

/** Bolds the first case-insensitive occurrence of `query` inside `text`. */
function Highlight({ text, query }) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text;
  return <>{text.slice(0, idx)}<strong>{text.slice(idx, idx + query.length)}</strong>{text.slice(idx + query.length)}</>;
}

/** Sidebar search across courses and teachers — always visible, unlike the per-page filter boxes.
    Picking a result navigates to that item's page; for admin/faculty (who have an edit modal for
    that entity) it also opens the item directly, so search doubles as a deep link. */
export default function GlobalSearch() {
  const { t } = useTranslation('shell');
  const { courses, teachers, departments, currentUser } = useAppData();
  const { openModal } = useModal();
  const { showSection } = useNavigation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const isAdmin = currentUser?.role === 'admin';
  const isStudent = currentUser?.role === 'student';
  const q = query.trim().toLowerCase();

  const courseMatches = useMemo(() => {
    if (!q) return [];
    return courses.filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS_PER_GROUP);
  }, [courses, q]);

  // Teachers only have a dedicated management page for admins — for other
  // roles there's nowhere to jump to, so don't surface them as results.
  const teacherMatches = useMemo(() => {
    if (!q || !isAdmin) return [];
    return teachers.filter(t => t.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS_PER_GROUP);
  }, [teachers, q, isAdmin]);

  const results = useMemo(() => [
    ...courseMatches.map(c => ({ kind: 'course', id: c.id, primary: `${c.code} — ${c.name}`, secondary: departmentName(departments, c.departmentId) })),
    ...teacherMatches.map(t => ({ kind: 'teacher', id: t.id, primary: t.name, secondary: departmentName(departments, t.departmentId) })),
  ], [courseMatches, teacherMatches, departments]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    function onDocClick(e) { if (open && wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  function jumpTo(result) {
    if (result.kind === 'course') {
      showSection(isStudent ? 'catalog' : 'courses');
      if (!isStudent) openModal('course', result.id); // Catalog has no per-row edit modal
    } else {
      showSection('teachers');
      openModal('teacher', result.id);
    }
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setQuery(''); setOpen(false); inputRef.current?.blur(); return; }
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => (i + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => (i - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); jumpTo(results[activeIndex]); }
  }

  return (
    <div className={'global-search' + (open && query ? ' open' : '')} ref={wrapRef}>
      <i className="ti ti-search global-search-icon" aria-hidden="true"></i>
      <input
        ref={inputRef}
        type="text"
        className="global-search-input"
        placeholder={t('search.placeholder')}
        aria-label={t('search.ariaLabel')}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {query && (
        <button type="button" className="global-search-clear" aria-label={t('search.clear')} onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
          <i className="ti ti-x" aria-hidden="true"></i>
        </button>
      )}
      {open && query && (
        <div className="global-search-results" role="listbox">
          {results.length ? results.map((r, i) => (
            <button
              type="button" key={r.kind + r.id}
              className={'global-search-item' + (i === activeIndex ? ' active' : '')}
              role="option" aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => jumpTo(r)}
            >
              <i className={'ti ' + (r.kind === 'course' ? 'ti-book' : 'ti-user') + ' global-search-item-icon'} aria-hidden="true"></i>
              <span className="global-search-item-text">
                <span className="global-search-item-primary"><Highlight text={r.primary} query={q} /></span>
                <span className="global-search-item-secondary">{r.secondary}</span>
              </span>
              <span className="global-search-item-kind">{r.kind === 'course' ? t('search.course') : t('search.teacher')}</span>
            </button>
          )) : (
            <div className="global-search-empty">{t('search.noMatches', { query })}</div>
          )}
        </div>
      )}
    </div>
  );
}
