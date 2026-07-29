import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { saveCourse } from '../../api.js';

/** Lets an admin (re)assign existing courses to this teacher — used both as an optional step
    in the onboarding wizard ("Initial Course Assignments") and as a Full Profile panel for
    later reassignment. Courses always carry a teacherId once created (CourseForm requires
    picking one), so this is a takeover/reassignment tool, not just "fill in the unassigned
    ones" — department-scoped by default to keep the list relevant, with a toggle to see all. */
export default function TeacherCourseAssignmentsSection({ teacherId, departmentId, canWrite, onChanged }) {
  const { t } = useTranslation(['teacherProfile', 'common']);
  const { courses, teachers } = useAppData();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const [showAllDepartments, setShowAllDepartments] = useState(!departmentId);
  const [selected, setSelected] = useState(() => new Set());

  const visible = (showAllDepartments || !departmentId ? courses : courses.filter(c => c.departmentId === departmentId))
    .filter(c => c.teacherId !== teacherId);
  const assigned = courses.filter(c => c.teacherId === teacherId);
  const teacherName = (id) => teachers.find(tc => tc.id === id)?.name || t('common:notApplicable');

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleAssign() {
    if (selected.size === 0) return;
    try {
      await run(Promise.all([...selected].map(id => saveCourse({ teacherId }, id))));
      setSelected(new Set());
      await onChanged?.();
      toast(t('teacherProfile:courses.toasts.assigned', { count: selected.size }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="panel">
      <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.courses')}</div></div>
      {assigned.length === 0
        ? <div className="field-hint" style={{ padding: '10px 0' }}>{t('teacherProfile:courses.noneAssigned')}</div>
        : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {assigned.map(c => <span key={c.id} className="pill pill-blue">{c.code} — {c.name}</span>)}
          </div>
        )}
      {canWrite && (
        <>
          <div className="field-hint" style={{ marginBottom: 6 }}>{t('teacherProfile:courses.assignHint')}</div>
          {departmentId != null && (
            <label className="field-hint" style={{ display: 'block', marginBottom: 6 }}>
              <input type="checkbox" checked={showAllDepartments} onChange={e => setShowAllDepartments(e.target.checked)} /> {t('teacherProfile:courses.showAllDepartments')}
            </label>
          )}
          {visible.length === 0 && <div className="field-hint" style={{ padding: '10px 0' }}>{t('teacherProfile:courses.noneAvailable')}</div>}
          {visible.length > 0 && (
            <>
              <table className="data-table">
                <thead><tr><th></th><th>{t('teacherProfile:courses.codeHeader')}</th><th>{t('teacherProfile:courses.nameHeader')}</th><th>{t('teacherProfile:courses.currentTeacherHeader')}</th></tr></thead>
                <tbody>
                  {visible.map(c => (
                    <tr key={c.id}>
                      <td><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                      <td><code>{c.code}</code></td>
                      <td>{c.name}</td>
                      <td>{c.teacherId != null ? teacherName(c.teacherId) : t('common:notApplicable')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className={'btn-sm' + (loading ? ' btn-loading' : '')} disabled={loading || selected.size === 0} style={{ marginTop: 8 }} onClick={handleAssign}>
                {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('teacherProfile:courses.assign', { count: selected.size })}</>}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
