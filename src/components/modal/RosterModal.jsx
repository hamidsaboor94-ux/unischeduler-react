import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api, withdrawFromCourse } from '../../api.js';
import { courseById, csvEscape, downloadFile } from '../../utils.js';

/** Port of openRoster() — the roster stays live against courseRosters from context, so grade
    changes and admin-enrollments re-render in place after each reload() (the original re-called
    openRoster(courseId) after every mutation; here the same openModal stays mounted and context
    updates flow through). */
export default function RosterModal({ editId: courseId }) {
  const { t } = useTranslation(['academics', 'common']);
  const { courses, courseRosters, allUsers, currentUser, reload, afterMutate } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { toast } = useToast();
  const [selectedStudent, setSelectedStudent] = useState('');

  const course = courseById(courses, courseId);
  const roster = courseRosters.get(courseId) || [];
  const enrolledIds = new Set(roster.map(r => r.studentId));
  const availableStudents = allUsers.filter(u => u.role === 'student' && !enrolledIds.has(u.id));

  async function adminEnrollStudent() {
    if (!selectedStudent) { toast(t('academics:rosterModal.pickStudentFirst'), 'warning'); return; }
    try {
      const enrollment = await api('POST', '/enrollments', { courseId, studentId: Number(selectedStudent) });
      toast(enrollment.status === 'waitlisted' ? t('academics:rosterModal.courseFullWaitlisted') : t('academics:rosterModal.studentEnrolled'));
      setSelectedStudent('');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

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
                <button className="icon-btn danger" aria-label={t('academics:rosterModal.removeAriaLabel', { name: r.name })} onClick={() => removeStudent(r)}>
                  <i className="ti ti-x" aria-hidden="true"></i>
                </button>
              </span>
            </div>
          )) : <div className="field-hint">{t('academics:rosterModal.noStudents')}</div>}
        </div>
        {currentUser.role === 'admin' && (
          <>
            <div className="form-row" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div className="form-label">{t('academics:rosterModal.enrollExisting')}</div>
              <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
                <option value="">{t('academics:rosterModal.selectStudent')}</option>
                {availableStudents.map(u => <option key={u.id} value={u.id}>{u.idNumber ? `${u.idNumber} — ` : ''}{u.name}</option>)}
              </select>
            </div>
            <button className="btn-sm" onClick={adminEnrollStudent}><i className="ti ti-plus"></i> {t('academics:rosterModal.addToCourse')}</button>
          </>
        )}
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={exportRosterCsv}><i className="ti ti-download"></i> {t('academics:rosterModal.exportCsv')}</button>
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
      </div>
    </>
  );
}
