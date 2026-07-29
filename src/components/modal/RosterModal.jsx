import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { withdrawFromCourse } from '../../api.js';
import { courseById, csvEscape, downloadFile } from '../../utils.js';
import CourseScheduleSummary from './CourseScheduleSummary.jsx';

/** Port of openRoster() — the roster stays live against courseRosters from context, so grade
    changes and registrar/admin-enrollments re-render in place after each reload() (the original
    re-called openRoster(courseId) after every mutation; here the same openModal stays mounted and
    context updates flow through). */
export default function RosterModal({ editId: courseId }) {
  const { t } = useTranslation(['academics', 'common']);
  const { courses, courseRosters, currentUser, afterMutate } = useAppData();
  const { closeModal, confirmAction, openModal } = useModal();
  const { toast } = useToast();

  const course = courseById(courses, courseId);
  const roster = courseRosters.get(courseId) || [];
  // Mirrors the server's canModifyEnrollment (see api/src/ownership.js): enrollment write
  // (enroll or withdraw) is Super Admin/Registrar only — Faculty can view the roster (grades/
  // attendance are their domain) but do not add or remove students from it.
  const canModify = currentUser.role === 'admin' || currentUser.role === 'registrar';

  function removeStudent(r) {
    closeModal();
    confirmAction(t('academics:rosterModal.removeConfirm', { name: r.name }), () => afterMutate(withdrawFromCourse(r.enrollmentId), t('academics:rosterModal.removed')));
  }

  function exportRosterCsv() {
    const header = [
      t('academics:rosterModal.csv.studentId'),
      t('academics:rosterModal.csv.name'),
      t('academics:rosterModal.csv.email'),
      t('academics:rosterModal.csv.status'),
      t('academics:rosterModal.csv.grade'),
    ];
    const rows = roster.map(r => [r.idNumber || '', r.name, r.email || '', r.status, r.grade || '']);
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
    downloadFile(`roster-${course.code}.csv`, csv, 'text/csv');
    toast(t('academics:rosterModal.rosterExported'));
  }

  return (
    <>
      <div id="modal-body">
        {course && <CourseScheduleSummary course={course} />}
        <div className="roster-list">
          {roster.length ? roster.map(r => (
            <div className="roster-row" key={r.enrollmentId}>
              <span>
                <code className="roster-id">{r.idNumber || '—'}</code> {r.name}{' '}
                {r.status === 'waitlisted'
                  ? <span className="pill pill-amber" style={{ marginInlineStart: 6 }}>{t('academics:rosterModal.waitlistPill')}</span>
                  : r.grade ? <span className="pill pill-blue" style={{ marginInlineStart: 6 }}>{r.grade}</span> : null}
              </span>
              <span style={{ display: 'flex', alignItems: 'center' }}>
                {canModify && (
                  <button className="icon-btn danger" aria-label={t('academics:rosterModal.removeAriaLabel', { name: r.name })} onClick={() => removeStudent(r)}>
                    <i className="ti ti-x" aria-hidden="true"></i>
                  </button>
                )}
              </span>
            </div>
          )) : <div className="field-hint">{t('academics:rosterModal.noStudents')}</div>}
        </div>
        {canModify && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button className="btn-sm" onClick={() => openModal('enroll-students', courseId)}>
              <i className="ti ti-user-plus" aria-hidden="true"></i> {t('academics:rosterModal.enrollStudents')}
            </button>
          </div>
        )}
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={exportRosterCsv}><i className="ti ti-download"></i> {t('academics:rosterModal.exportCsv')}</button>
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
      </div>
    </>
  );
}
