import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchCourseGradebook, saveGradeItem, deleteGradeItem, setGradeScore, fetchDepartmentGradeSummary } from '../api.js';
import { exportRowsToXlsx } from '../utils.js';

/** Admin/faculty grade entry sheet: a spreadsheet-style table for one course at a time — every
    enrolled student is a row (automatically, no manual add), every grade item is a column. A
    course starts with four standard columns (Quiz 1, Assignment, Midterm, Final) the first time
    its gradebook is opened (see ensureDefaultGradeItems on the backend); the only column-editing
    exposed here is adding another quiz and adjusting a column's max score (a simple way to define
    "weighting" without a full formula system) — everything else about the sheet's shape is fixed
    on purpose, matching a normal grade sheet. Faculty only ever see their own courses (`courses`
    is already scoped server-side, same as every other admin/faculty page); admins additionally
    get a department-wide (or all-courses) class-average rollup below. */
export default function GradebookPage() {
  const { t } = useTranslation(['gradebook', 'common']);
  const { courses, departments, currentUser } = useAppData();
  const { confirmAction } = useModal();
  const { activeSection, sectionFocus } = useNavigation();
  const { toast } = useToast();
  const isAdmin = currentUser.role === 'admin';

  const [departmentFilter, setDepartmentFilter] = useState('');
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [gradebook, setGradebook] = useState({ items: [], rows: [] });
  const [loading, setLoading] = useState(false);
  const [scoreDrafts, setScoreDrafts] = useState({}); // `${itemId}:${studentId}` -> string being edited
  const [scoreErrors, setScoreErrors] = useState({}); // same key -> true while the draft is out of range
  const [maxDrafts, setMaxDrafts] = useState({}); // itemId -> max-score string being edited
  const [addingQuiz, setAddingQuiz] = useState(false);
  const [deptSummary, setDeptSummary] = useState([]);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const visibleCourses = useMemo(() => (
    isAdmin && departmentFilter ? courses.filter(c => c.departmentId === Number(departmentFilter)) : courses
  ), [courses, departmentFilter, isAdmin]);

  useEffect(() => {
    if (!visibleCourses.some(c => c.id === Number(courseId))) setCourseId(visibleCourses[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCourses]);

  // A course quick action ("Enter Marks") lands here with a course to preselect — clear any
  // admin department filter first so the target course isn't hidden from visibleCourses.
  useEffect(() => {
    if (sectionFocus?.section === 'gradebook' && sectionFocus.courseId != null && courses.some(c => c.id === sectionFocus.courseId)) {
      setDepartmentFilter('');
      setCourseId(sectionFocus.courseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionFocus]);

  async function loadGradebook() {
    // Every page in this app stays mounted at all times regardless of role (see AppShell.jsx) —
    // this page is admin/faculty only, so skip the fetch entirely for anyone else. Without this,
    // a student's very first courseId (courses[0], the full catalog for them, not scoped like
    // it is for faculty) would silently 403 against this admin/faculty-only endpoint the moment
    // the app boots, and the resulting error toast would show up in their notification bell.
    if (activeSection !== 'gradebook') return;
    if (!courseId || (!isAdmin && currentUser.role !== 'faculty')) {
      setGradebook({ items: [], rows: [] });
      return;
    }
    setLoading(true);
    try {
      setGradebook(await fetchCourseGradebook(courseId));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadGradebook(); setScoreDrafts({}); setScoreErrors({}); setMaxDrafts({}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeSection, courseId]);

  async function loadDeptSummary() {
    if (activeSection !== 'gradebook' || !isAdmin) return;
    setLoadingSummary(true);
    try {
      setDeptSummary(await fetchDepartmentGradeSummary(departmentFilter || null));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoadingSummary(false);
    }
  }
  useEffect(() => { loadDeptSummary(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeSection, departmentFilter, isAdmin]);

  const quizItems = gradebook.items.filter(i => i.category === 'quiz');
  function itemLabel(item) {
    if (item.category === 'quiz') return `${t('gradebook:gradebookPage.categories.quiz')} ${quizItems.indexOf(item) + 1}`;
    return t(`gradebook:gradebookPage.categories.${item.category}`);
  }

  async function handleAddQuiz() {
    if (!courseId) { toast(t('gradebook:gradebookPage.toasts.pickCourse'), 'warning'); return; }
    setAddingQuiz(true);
    try {
      await saveGradeItem({
        courseId: Number(courseId),
        name: `Quiz ${quizItems.length + 1}`,
        category: 'quiz',
        maxScore: quizItems[0]?.maxScore || 10,
      });
      toast(t('gradebook:gradebookPage.toasts.itemAdded'));
      await loadGradebook();
      await loadDeptSummary();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAddingQuiz(false);
    }
  }

  function handleDeleteItem(item) {
    confirmAction(
      t('gradebook:gradebookPage.deleteItemConfirm', { name: itemLabel(item) }),
      async () => {
        try {
          await deleteGradeItem(item.id);
          toast(t('gradebook:gradebookPage.toasts.itemDeleted'));
          await loadGradebook();
          await loadDeptSummary();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
      t('common:actions.delete')
    );
  }

  async function handleMaxScoreCommit(item) {
    const draft = maxDrafts[item.id];
    if (draft === undefined) return;
    const value = Number(draft);
    if (!(value > 0)) {
      toast(t('gradebook:gradebookPage.toasts.maxScoreInvalid'), 'warning');
      setMaxDrafts(prev => { const next = { ...prev }; delete next[item.id]; return next; });
      return;
    }
    if (value === item.maxScore) { setMaxDrafts(prev => { const next = { ...prev }; delete next[item.id]; return next; }); return; }
    try {
      await saveGradeItem({ name: item.name, category: item.category, maxScore: value }, item.id);
      await loadGradebook();
      await loadDeptSummary();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMaxDrafts(prev => { const next = { ...prev }; delete next[item.id]; return next; });
    }
  }

  function draftKey(itemId, studentId) { return `${itemId}:${studentId}`; }

  function handleScoreChange(item, row, raw) {
    const key = draftKey(item.id, row.studentId);
    setScoreDrafts(prev => ({ ...prev, [key]: raw }));
    const invalid = raw !== '' && (Number.isNaN(Number(raw)) || Number(raw) < 0 || Number(raw) > item.maxScore);
    setScoreErrors(prev => ({ ...prev, [key]: invalid }));
  }

  async function handleScoreCommit(item, row) {
    const key = draftKey(item.id, row.studentId);
    const draft = scoreDrafts[key];
    if (draft === undefined) return;
    if (scoreErrors[key]) {
      toast(t('gradebook:gradebookPage.toasts.scoreOutOfRange', { max: item.maxScore }), 'warning');
      return;
    }
    const current = row.scores[item.id];
    const currentStr = current == null ? '' : String(current);
    if (draft === currentStr) return;
    try {
      await setGradeScore({ gradeItemId: item.id, studentId: row.studentId, score: draft === '' ? null : Number(draft) });
      await loadGradebook();
      await loadDeptSummary();
    } catch (err) {
      toast(err.message, 'error');
      setScoreDrafts(prev => { const next = { ...prev }; delete next[key]; return next; });
      setScoreErrors(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
  }

  function handleScoreKeyDown(e) {
    if (e.key === 'Enter') e.target.blur();
  }

  function handleExport() {
    const course = visibleCourses.find(c => c.id === Number(courseId));
    const header = [
      t('gradebook:gradebookPage.table.studentId'),
      t('gradebook:gradebookPage.table.student'),
      ...gradebook.items.map(item => `${itemLabel(item)} (/${item.maxScore})`),
      `${t('gradebook:gradebookPage.table.total')} (/${gradebook.rows[0]?.totalPossible ?? gradebook.items.reduce((s, i) => s + i.maxScore, 0)})`,
      t('gradebook:gradebookPage.table.letterGrade'),
    ];
    const rows = gradebook.rows.map(row => [
      row.idNumber || '',
      row.name,
      ...gradebook.items.map(item => row.scores[item.id] ?? ''),
      row.hasAnyScore ? row.totalEarned : '',
      row.letterGrade || '',
    ]);
    exportRowsToXlsx(`gradesheet-${course ? course.code : courseId}.xlsx`, header, rows, 'Grades');
    toast(t('gradebook:gradebookPage.toasts.exported'));
  }

  return (
    <Section name="gradebook">
      <div className="topbar">
        <i className="ti ti-report-analytics" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('gradebook:gradebookPage.title')}</h2>
        <div className="topbar-actions">
          {isAdmin && (
            <select className="select-sm" aria-label={t('gradebook:gradebookPage.departmentAria')} value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)}>
              <option value="">{t('gradebook:gradebookPage.allDepartments')}</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select className="select-sm" aria-label={t('gradebook:gradebookPage.courseAria')} value={courseId} onChange={e => setCourseId(e.target.value)}>
            {visibleCourses.length
              ? visibleCourses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)
              : <option value="">{t('gradebook:gradebookPage.noCoursesYet')}</option>}
          </select>
        </div>
      </div>
      <div id="content">
        <div className="panel panel-cal" style={{ marginBottom: 14 }}>
          <div className="panel-header">
            <div className="panel-title">{t('gradebook:gradebookPage.title')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-sm" disabled={!courseId || addingQuiz} onClick={handleAddQuiz}>
                {addingQuiz ? <span className="spinner"></span> : <><i className="ti ti-plus"></i> {t('gradebook:gradebookPage.addQuiz')}</>}
              </button>
              <button type="button" className="btn-sm" disabled={!gradebook.rows.length} onClick={handleExport}>
                <i className="ti ti-file-spreadsheet"></i> {t('gradebook:gradebookPage.exportExcel')}
              </button>
            </div>
          </div>
          {loading ? (
            <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>
          ) : !gradebook.rows.length ? (
            <div className="field-hint" style={{ padding: 14 }}>{t('gradebook:gradebookPage.noStudentsEnrolled')}</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('gradebook:gradebookPage.table.studentId')}</th>
                  <th>{t('gradebook:gradebookPage.table.student')}</th>
                  {gradebook.items.map(item => {
                    const isExtraQuiz = item.category === 'quiz' && quizItems.indexOf(item) > 0;
                    const maxValue = maxDrafts[item.id] !== undefined ? maxDrafts[item.id] : String(item.maxScore);
                    return (
                      <th key={item.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                          <div>
                            <div>{itemLabel(item)}</div>
                            <div className="field-hint" style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                              /
                              <input
                                type="number" min="1" style={{ width: 44, padding: '1px 4px', fontSize: 10.5 }}
                                aria-label={itemLabel(item)}
                                value={maxValue}
                                onChange={e => setMaxDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                                onBlur={() => handleMaxScoreCommit(item)}
                                onKeyDown={handleScoreKeyDown}
                              />
                            </div>
                          </div>
                          {isExtraQuiz && (
                            <button type="button" className="icon-btn danger" title={t('common:actions.delete')} aria-label={t('common:actions.delete')} onClick={() => handleDeleteItem(item)}>
                              <i className="ti ti-x" aria-hidden="true"></i>
                            </button>
                          )}
                        </div>
                      </th>
                    );
                  })}
                  <th>{t('gradebook:gradebookPage.table.total')}</th>
                  <th>{t('gradebook:gradebookPage.table.letterGrade')}</th>
                </tr>
              </thead>
              <tbody>
                {gradebook.rows.map(row => (
                  <tr key={row.studentId}>
                    <td>{row.idNumber || t('common:notApplicable')}</td>
                    <td>{row.name}</td>
                    {gradebook.items.map(item => {
                      const key = draftKey(item.id, row.studentId);
                      const value = scoreDrafts[key] !== undefined ? scoreDrafts[key] : (row.scores[item.id] == null ? '' : String(row.scores[item.id]));
                      const invalid = !!scoreErrors[key];
                      return (
                        <td key={item.id}>
                          <input
                            type="number" min="0" max={item.maxScore} style={{ width: 64, borderColor: invalid ? 'var(--danger)' : undefined }}
                            aria-label={`${row.name} — ${itemLabel(item)}`}
                            aria-invalid={invalid}
                            value={value}
                            onChange={e => handleScoreChange(item, row, e.target.value)}
                            onBlur={() => handleScoreCommit(item, row)}
                            onKeyDown={handleScoreKeyDown}
                          />
                        </td>
                      );
                    })}
                    <td>{row.hasAnyScore ? `${row.totalEarned} / ${row.totalPossible}` : t('common:notApplicable')}</td>
                    <td>{row.letterGrade || (row.hasAnyScore ? t('gradebook:gradebookPage.inProgress') : t('common:notApplicable'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {isAdmin && (
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('gradebook:gradebookPage.departmentSummary.title')}</div>
                <div className="panel-subtitle">{t('gradebook:gradebookPage.departmentSummary.hint')}</div>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('gradebook:gradebookPage.departmentSummary.table.course')}</th>
                  <th>{t('gradebook:gradebookPage.departmentSummary.table.students')}</th>
                  <th>{t('gradebook:gradebookPage.departmentSummary.table.graded')}</th>
                  <th>{t('gradebook:gradebookPage.departmentSummary.table.average')}</th>
                </tr>
              </thead>
              <tbody>
                {loadingSummary ? (
                  <tr><td colSpan={4} className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</td></tr>
                ) : deptSummary.length ? deptSummary.map(s => (
                  <tr key={s.course.id} onClick={() => setCourseId(s.course.id)}>
                    <td>{s.course.code} — {s.course.name}</td>
                    <td>{s.studentCount}</td>
                    <td>{s.gradedCount}</td>
                    <td>{s.classAverage != null ? `${s.classAverage}%` : t('gradebook:gradebookPage.departmentSummary.noAverageYet')}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="field-hint" style={{ padding: 14 }}>{t('gradebook:gradebookPage.departmentSummary.noCourses')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}
