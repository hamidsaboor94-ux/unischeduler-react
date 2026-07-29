import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { fetchStudentProfile, fetchEligibleCourses } from '../api.js';
import { departmentName, groupCourseSections } from '../utils.js';

const EMPTY_CATALOG = { eligible: [], currentlyEnrolled: [], completed: [], notYetEligible: [], notOffered: [] };

/** Maps the eligible-courses API's entry shape (courseId/courseCode/courseName) onto the
    course-shaped object groupCourseSections/CourseDetailModal expect (id/code/name), so the
    existing same-term-section grouping and section-picker modal can be reused unchanged. */
function asCourseShape(entry) {
  return { id: entry.courseId, code: entry.courseCode, name: entry.courseName, credits: entry.credits, departmentId: entry.departmentId, termId: entry.termId };
}

export default function CatalogPage() {
  const { t } = useTranslation(['academics', 'common']);
  const { currentUser, departments, myEnrollments, terms, activeTermId } = useAppData();
  const { openModal } = useModal();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [myDepartmentId, setMyDepartmentId] = useState(undefined);
  const [catalog, setCatalog] = useState(null); // null = loading

  const load = useCallback(() => {
    fetchEligibleCourses().then(setCatalog).catch(() => setCatalog(EMPTY_CATALOG));
  }, []);

  useEffect(() => {
    fetchStudentProfile(currentUser.id)
      .then(p => setMyDepartmentId(p.departmentId ?? null))
      .catch(() => setMyDepartmentId(null));
    load();
  }, [currentUser.id, load]);

  const activeTerm = terms.find(term => term.id === activeTermId);
  const currentTermCredits = myEnrollments
    .filter(e => e.status === 'enrolled' && e.termId === activeTermId)
    .reduce((sum, e) => sum + (e.credits || 0), 0);
  const overLimit = activeTerm?.creditLimit != null && currentTermCredits > activeTerm.creditLimit;

  const q = search.trim().toLowerCase();
  function filterEntries(list) {
    let out = deptFilter ? list.filter(c => String(c.departmentId) === deptFilter) : list;
    if (q) out = out.filter(c => c.courseCode.toLowerCase().includes(q) || c.courseName.toLowerCase().includes(q));
    return out;
  }

  const data = catalog || EMPTY_CATALOG;
  const eligibleGroups = useMemo(
    () => groupCourseSections(filterEntries(data.eligible).map(asCourseShape)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.eligible, deptFilter, q]
  );
  const notYetEligibleGroups = useMemo(() => {
    const groups = groupCourseSections(filterEntries(data.notYetEligible).map(asCourseShape));
    // Attach the richest (first) entry's reason/prerequisites — sections of the same course
    // normally share the same prerequisite configuration.
    const byId = new Map(data.notYetEligible.map(e => [e.courseId, e]));
    return groups.map(g => ({ ...g, detail: byId.get(g.options[0].id) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.notYetEligible, deptFilter, q]);
  const currentlyEnrolled = filterEntries(data.currentlyEnrolled);
  const completed = filterEntries(data.completed);
  const notOffered = filterEntries(data.notOffered);

  function seatsSummary(group) {
    const entries = group.options.map(o => data.eligible.find(e => e.courseId === o.id)).filter(Boolean);
    if (entries.some(e => e.availableSeats == null)) return t('academics:courseDetailModal.openSeats');
    return entries.reduce((sum, e) => sum + e.availableSeats, 0);
  }

  function openEligible(group) {
    openModal('course-detail', null, {
      optionIds: group.options.map(o => o.id),
      myDepartmentId,
      currentTermCredits,
      creditLimit: activeTerm?.creditLimit ?? null,
      onEnrolled: load,
    });
  }

  return (
    <Section name="catalog">
      <div className="topbar">
        <i className="ti ti-book" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('academics:catalogPage.title')}</h2>
        <div className="topbar-actions">
          <input type="text" className="select-sm" aria-label={t('academics:catalogPage.searchAria')} placeholder={t('academics:catalogPage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          <select className="select-sm" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">{t('academics:catalogPage.allDepartments')}</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>
      <div id="content">
        {activeTerm && (
          <div className="panel-subtitle" style={{ marginBottom: 10 }}>
            <span className={'pill ' + (overLimit ? 'pill-red' : 'pill-gray')}>
              {activeTerm.creditLimit != null
                ? t('academics:catalogPage.creditsWithLimit', { current: currentTermCredits, limit: activeTerm.creditLimit })
                : t('academics:catalogPage.creditsNoLimit', { current: currentTermCredits })} — {activeTerm.name}
            </span>
          </div>
        )}

        {!catalog ? (
          <div className="field-hint">{t('common:actions.loading')}</div>
        ) : (
          <>
            <div className="panel-title" style={{ marginTop: 4, marginBottom: 8 }}>{t('academics:catalogPage.sections.eligible')}</div>
            <div className="panel">
              {eligibleGroups.length ? (
                <table className="data-table">
                  <thead><tr>
                    <th>{t('academics:catalogPage.table.code')}</th>
                    <th>{t('academics:catalogPage.table.courseName')}</th>
                    <th>{t('academics:catalogPage.table.dept')}</th>
                    <th>{t('academics:catalogPage.table.credits')}</th>
                    <th>{t('academics:catalogPage.table.sections')}</th>
                    <th>{t('academics:catalogPage.table.capacity')}</th>
                    <th></th>
                  </tr></thead>
                  <tbody>
                    {eligibleGroups.map(g => (
                      <tr key={g.key} style={{ cursor: 'pointer' }} onClick={() => openEligible(g)}>
                        <td>{g.code}{g.options.length > 1 ? ` +${g.options.length - 1}` : ''}</td>
                        <td>{g.name}</td>
                        <td>{departmentName(departments, g.departmentId)}</td>
                        <td>{g.credits}</td>
                        <td>{g.options.length}</td>
                        <td>{seatsSummary(g)}</td>
                        <td><button className="btn-sm" onClick={e => { e.stopPropagation(); openEligible(g); }}>{t('academics:catalogPage.viewDetails')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="field-hint">{t('academics:catalogPage.emptySection')}</div>}
            </div>

            <div className="panel-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('academics:catalogPage.sections.currentlyEnrolled')}</div>
            <div className="panel">
              {currentlyEnrolled.length ? (
                <table className="data-table">
                  <thead><tr>
                    <th>{t('academics:catalogPage.table.code')}</th>
                    <th>{t('academics:catalogPage.table.courseName')}</th>
                    <th>{t('academics:catalogPage.table.credits')}</th>
                    <th></th>
                  </tr></thead>
                  <tbody>
                    {currentlyEnrolled.map(c => (
                      <tr key={c.courseId}>
                        <td>{c.courseCode}</td>
                        <td>{c.courseName}</td>
                        <td>{c.credits}</td>
                        <td>
                          {c.enrollmentStatus === 'waitlisted'
                            ? <span className="pill pill-amber">{t('academics:catalogPage.waitlisted')}</span>
                            : <span className="pill pill-green">{t('academics:catalogPage.enrolled')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="field-hint">{t('academics:catalogPage.emptySection')}</div>}
            </div>

            <div className="panel-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('academics:catalogPage.sections.notYetEligible')}</div>
            <div className="panel">
              {notYetEligibleGroups.length ? notYetEligibleGroups.map(g => (
                <div key={g.key} className="panel" style={{ marginBottom: 10, opacity: 0.85 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div>
                      <div><strong>{g.code}{g.options.length > 1 ? ` +${g.options.length - 1}` : ''}</strong> — {g.name}</div>
                      <div className="field-hint" style={{ marginTop: 4 }}>{departmentName(departments, g.departmentId)} · {t('academics:courseQuickLook.credits', { count: g.credits })}</div>
                      {!!g.detail?.prerequisites?.length && (
                        <div style={{ marginTop: 6 }}>
                          <div className="field-hint">{t('academics:catalogPage.prerequisitesLabel')}:</div>
                          {g.detail.prerequisites.map((req, i) => (
                            <div key={i} style={{ fontSize: 13 }}>
                              {req.options.map((o, j) => (
                                <span key={o.courseId}>
                                  {j > 0 && ` ${t('common:orConjunction')} `}
                                  <i className={'ti ' + (o.completed ? 'ti-circle-check' : 'ti-circle-x')} style={{ color: o.completed ? 'var(--success)' : 'var(--danger)' }} aria-hidden="true"></i> {o.courseCode}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                      {g.detail?.reason && (
                        <div className="alert-item alert-warn" style={{ marginTop: 8 }}>
                          <i className="ti ti-lock" aria-hidden="true"></i> {g.detail.reason}
                        </div>
                      )}
                    </div>
                    <span className="pill pill-gray">{t('academics:catalogPage.locked')}</span>
                  </div>
                </div>
              )) : <div className="field-hint">{t('academics:catalogPage.emptySection')}</div>}
            </div>

            <div className="panel-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('academics:catalogPage.sections.completed')}</div>
            <div className="panel">
              {completed.length ? (
                <table className="data-table">
                  <thead><tr>
                    <th>{t('academics:catalogPage.table.code')}</th>
                    <th>{t('academics:catalogPage.table.courseName')}</th>
                    <th>{t('academics:catalogPage.table.credits')}</th>
                    <th>{t('academics:catalogPage.grade')}</th>
                  </tr></thead>
                  <tbody>
                    {completed.map(c => (
                      <tr key={c.courseId}>
                        <td>{c.courseCode}</td>
                        <td>{c.courseName}</td>
                        <td>{c.credits}</td>
                        <td>{c.grade || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="field-hint">{t('academics:catalogPage.emptySection')}</div>}
            </div>

            <div className="panel-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('academics:catalogPage.sections.notOffered')}</div>
            <div className="panel">
              {notOffered.length ? (
                <table className="data-table">
                  <thead><tr>
                    <th>{t('academics:catalogPage.table.code')}</th>
                    <th>{t('academics:catalogPage.table.courseName')}</th>
                    <th>{t('academics:catalogPage.table.dept')}</th>
                    <th>{t('academics:catalogPage.table.credits')}</th>
                  </tr></thead>
                  <tbody>
                    {notOffered.map(c => (
                      <tr key={c.courseId}>
                        <td>{c.courseCode}</td>
                        <td>{c.courseName}</td>
                        <td>{departmentName(departments, c.departmentId)}</td>
                        <td>{c.credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="field-hint">{t('academics:catalogPage.emptySection')}</div>}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
