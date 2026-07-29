import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { fetchEligibleStudents, bulkEnrollStudents } from '../../api.js';
import { courseById, enrolledCount } from '../../utils.js';
import CourseScheduleSummary from './CourseScheduleSummary.jsx';

/** Registrar/Admin "Enroll students" picker — fetches the course's eligible-student candidates
    (department-scoped, see api's GET /courses/:id/eligible-students), lets the caller filter by
    semester and either check individuals or "select all in this semester", then submits everyone
    checked through POST /enrollments/bulk in one call. Capacity and duplicate handling are fully
    server-enforced (see enrollments.js); this UI only reflects what comes back. */
export default function EnrollStudentsModal({ editId: courseId }) {
  const { t } = useTranslation(['academics', 'common']);
  const { courses, courseRosters, reload } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();

  const [students, setStudents] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState(null);
  const [semester, setSemester] = useState('all');
  const [selected, setSelected] = useState(new Set());

  const course = courseById(courses, courseId);

  useEffect(() => {
    let cancelled = false;
    fetchEligibleStudents(courseId)
      .then(rows => { if (!cancelled) setStudents(rows); })
      .catch(err => { if (!cancelled) setLoadError(err.message); });
    return () => { cancelled = true; };
  }, [courseId]);

  const semesters = useMemo(() => {
    if (!students) return [];
    return [...new Set(students.map(s => s.programSemester).filter(v => v != null))].sort((a, b) => a - b);
  }, [students]);

  const visible = useMemo(() => {
    if (!students) return [];
    if (semester === 'all') return students;
    return students.filter(s => String(s.programSemester) === String(semester));
  }, [students, semester]);

  const selectableVisible = visible.filter(s => !s.enrollmentStatus);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(s => selected.has(s.id));

  function toggleStudent(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) selectableVisible.forEach(s => next.delete(s.id));
      else selectableVisible.forEach(s => next.add(s.id));
      return next;
    });
  }

  function describeWarning(w) {
    const parts = [];
    if (w.prereqIssues.length) parts.push(t('academics:enrollStudentsModal.warningPrereq', { codes: w.prereqIssues.join(', ') }));
    if (w.scheduleClash) parts.push(t('academics:enrollStudentsModal.warningClash'));
    return `${w.name} (${parts.join('; ')})`;
  }

  function finishToast(enrolledTotal, skipped) {
    if (skipped.length) {
      const counts = new Map();
      skipped.forEach(s => counts.set(s.reason, (counts.get(s.reason) || 0) + 1));
      const reasons = [...counts.entries()].map(([reason, n]) => `${n} ${reason.toLowerCase()}`).join(', ');
      toast(t('academics:enrollStudentsModal.toastEnrolledWithSkipped', { enrolled: enrolledTotal, skipped: skipped.length, reasons }));
    } else {
      toast(t('academics:enrollStudentsModal.toastEnrolled', { count: enrolledTotal }));
    }
  }

  async function handleEnroll() {
    if (!selected.size) { toast(t('academics:enrollStudentsModal.pickAtLeastOne'), 'warning'); return; }
    try {
      const res = await run(bulkEnrollStudents(courseId, [...selected]));
      if (res.warnings.length) {
        // Clean picks are already enrolled at this point — only the flagged ones are held back
        // pending an explicit "enroll anyway" from the Registrar/Admin (see routes/enrollments.js).
        const list = res.warnings.map(describeWarning).join('; ');
        closeModal();
        confirmAction(
          t('academics:enrollStudentsModal.confirmOverride', { count: res.warnings.length, list }),
          async () => {
            try {
              const ids = res.warnings.map(w => w.studentId);
              const res2 = await bulkEnrollStudents(courseId, ids, ids);
              await reload();
              finishToast(res.enrolled.length + res2.enrolled.length, [...res.skipped, ...res2.skipped]);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
          t('academics:enrollStudentsModal.enrollAnywayButton')
        );
        return;
      }
      closeModal();
      await reload();
      finishToast(res.enrolled.length, res.skipped);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const enrolled = course ? enrolledCount(courseRosters, course.id) : 0;
  const seatsHint = course?.maxStudents != null
    ? t('academics:enrollStudentsModal.seatsHint', { enrolled, max: course.maxStudents })
    : null;

  return (
    <>
      <div id="modal-body">
        {course && <CourseScheduleSummary course={course} />}
        {seatsHint && <div className="field-hint" style={{ marginBottom: 10 }}>{seatsHint}</div>}

        <div className="form-row">
          <div className="form-label">{t('academics:enrollStudentsModal.semesterFilter')}</div>
          <select value={semester} onChange={e => setSemester(e.target.value)}>
            <option value="all">{t('academics:enrollStudentsModal.allSemesters')}</option>
            {semesters.map(s => <option key={s} value={s}>{t('academics:enrollStudentsModal.semesterOption', { semester: s })}</option>)}
          </select>
        </div>

        {students === null && !loadError && <div className="field-hint">{t('common:actions.loading')}</div>}
        {loadError && <div className="field-hint" style={{ color: 'var(--danger)' }}>{loadError}</div>}

        {students !== null && (
          <>
            <label className="checkbox-row" style={{ marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                disabled={!selectableVisible.length}
                onChange={toggleSelectAllVisible}
              />
              {semester === 'all'
                ? t('academics:enrollStudentsModal.selectAllShown', { count: selectableVisible.length })
                : t('academics:enrollStudentsModal.selectAllInSemester', { semester, count: selectableVisible.length })}
            </label>

            <div className="checkbox-list" style={{ maxHeight: 320 }}>
              {visible.length ? visible.map(s => (
                <label className="checkbox-row" key={s.id} style={s.enrollmentStatus ? { opacity: 0.55 } : undefined}>
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    disabled={!!s.enrollmentStatus}
                    onChange={() => toggleStudent(s.id)}
                  />
                  <code style={{ marginInlineEnd: 6 }}>{s.idNumber || '—'}</code>
                  {s.name}
                  {s.programSemester != null && (
                    <span className="pill pill-gray" style={{ marginInlineStart: 6 }}>
                      {t('academics:enrollStudentsModal.semesterOption', { semester: s.programSemester })}
                    </span>
                  )}
                  {s.enrollmentStatus === 'enrolled' && (
                    <span className="pill pill-blue" style={{ marginInlineStart: 6 }}>{t('academics:enrollStudentsModal.alreadyEnrolledPill')}</span>
                  )}
                  {s.enrollmentStatus === 'waitlisted' && (
                    <span className="pill pill-amber" style={{ marginInlineStart: 6 }}>{t('academics:rosterModal.waitlistPill')}</span>
                  )}
                </label>
              )) : <div className="field-hint">{t('academics:enrollStudentsModal.noEligibleStudents')}</div>}
            </div>
          </>
        )}
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button
          className={'btn-primary' + (loading ? ' btn-loading' : '')}
          style={{ marginInlineEnd: 0 }}
          disabled={loading || !selected.size}
          onClick={handleEnroll}
        >
          {loading ? <span className="spinner"></span> : t('academics:enrollStudentsModal.enrollSelected', { count: selected.size })}
        </button>
      </div>
    </>
  );
}
