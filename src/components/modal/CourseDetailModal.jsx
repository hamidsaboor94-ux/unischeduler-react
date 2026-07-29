import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { fetchCoursePrerequisites, fetchCourseSlots, registerForCourse } from '../../api.js';
import { departmentName, teacherName, roomName, fmt12Hour } from '../../utils.js';

/** Course detail + instructor/section picker, opened from a Course Catalog row. `prefill`:
    { optionIds, myDepartmentId, currentTermCredits, creditLimit } — every course row sharing
    the same name+term (see utils.js's groupCourseSections) is one "option" here: pick which
    instructor/section, then register for that specific course row. All eligibility checks shown
    here are also enforced server-side in POST /enrollments — this view only decides what to
    show/disable, never what's actually allowed. */
export default function CourseDetailModal({ prefill }) {
  const { t } = useTranslation(['academics', 'common']);
  const { courses, departments, teachers, rooms, myEnrollments } = useAppData();
  const { closeModal } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const [registeringId, setRegisteringId] = useState(null);
  const [prereqsByCourseId, setPrereqsByCourseId] = useState({});
  const [loadingPrereqs, setLoadingPrereqs] = useState(true);
  const [slotsByCourseId, setSlotsByCourseId] = useState({});
  const [loadingSlots, setLoadingSlots] = useState(true);

  const { optionIds, myDepartmentId, currentTermCredits, creditLimit, onEnrolled } = prefill;
  const options = optionIds.map(id => courses.find(c => c.id === id)).filter(Boolean);
  const primary = options[0];

  useEffect(() => {
    setLoadingPrereqs(true);
    Promise.all(optionIds.map(id => fetchCoursePrerequisites(id).then(rows => [id, rows])))
      .then(entries => setPrereqsByCourseId(Object.fromEntries(entries)))
      .catch(() => {})
      .finally(() => setLoadingPrereqs(false));
    // GET /slots (AppDataContext's global `slots`) is scoped server-side to the caller's own
    // enrolled/owned courses — useless here, since the whole point of this view is a course the
    // student hasn't enrolled in yet. GET /courses/:id/slots is the unscoped, per-course
    // equivalent (same data GET /slots would show once enrolled — day/time/room aren't sensitive).
    setLoadingSlots(true);
    Promise.all(optionIds.map(id => fetchCourseSlots(id).then(rows => [id, rows])))
      .then(entries => setSlotsByCourseId(Object.fromEntries(entries)))
      .catch(() => {})
      .finally(() => setLoadingSlots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myStatusByCourseId = new Map(myEnrollments.map(e => [e.id, e.status]));

  /** Prerequisites still unmet for one option — "enrolled" (grade not yet a fail) already
      satisfies a prerequisite while it's in progress, matching the server's own rule. */
  function unmetPrereqCodes(courseId) {
    const prereqs = prereqsByCourseId[courseId] || [];
    return prereqs
      .filter(p => !myEnrollments.some(e => e.id === p.id && e.status === 'enrolled' && (e.grade == null || e.grade !== 'F')))
      .map(p => p.code);
  }

  async function handleRegister(courseId) {
    setRegisteringId(courseId);
    try {
      const enrollment = await run(registerForCourse(courseId));
      toast(enrollment.status === 'waitlisted' ? t('academics:catalogPage.toasts.waitlisted') : t('academics:catalogPage.toasts.registered'));
      onEnrolled?.();
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRegisteringId(null);
    }
  }

  if (!primary) return null;

  const alreadyEnrolledOptionId = options.find(o => {
    const s = myStatusByCourseId.get(o.id);
    return s === 'enrolled' || s === 'waitlisted';
  })?.id;
  const deptMismatch = myDepartmentId != null && primary.departmentId != null && Number(myDepartmentId) !== Number(primary.departmentId);

  return (
    <>
      <div id="modal-body">
        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            <span><strong>{t('academics:catalogPage.table.dept')}:</strong> {departmentName(departments, primary.departmentId)}</span>
            <span><strong>{t('academics:catalogPage.table.credits')}:</strong> {primary.credits}</span>
          </div>
          <div className="field-hint" style={{ marginTop: 10 }}>
            {primary.description || t('academics:courseDetailModal.noDescription')}
          </div>
          {deptMismatch && (
            <div className="alert-item alert-warn" style={{ marginTop: 10 }}>
              <i className="ti ti-alert-triangle" aria-hidden="true"></i>
              {t('academics:courseDetailModal.notInYourDepartment')}
            </div>
          )}
        </div>

        <div className="panel-title" style={{ marginBottom: 8 }}>{t('academics:courseDetailModal.sectionsTitle')}</div>
        {options.map(opt => {
          const optSlots = slotsByCourseId[opt.id] || [];
          const status = myStatusByCourseId.get(opt.id);
          const remaining = opt.maxStudents != null ? opt.maxStudents - (opt.enrolledCount || 0) : null;
          const isFull = remaining != null && remaining <= 0;
          const missingPrereqs = unmetPrereqCodes(opt.id);
          const wouldExceedCredits = creditLimit != null && (currentTermCredits + (opt.credits || 0)) > creditLimit;
          const blockedBySibling = alreadyEnrolledOptionId != null && alreadyEnrolledOptionId !== opt.id;

          let reason = null;
          if (blockedBySibling) reason = t('academics:courseDetailModal.reasons.enrolledElsewhere');
          else if (deptMismatch) reason = t('academics:courseDetailModal.reasons.notInDepartment');
          else if (missingPrereqs.length) reason = t('academics:courseDetailModal.reasons.missingPrerequisite', { code: missingPrereqs.join(', ') });
          else if (wouldExceedCredits) reason = t('academics:courseDetailModal.reasons.overCreditLimit');

          const disabled = !!reason || loadingPrereqs || loading;

          return (
            <div className="panel" key={opt.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <div><strong>{opt.code}</strong> — {teacherName(teachers, opt.teacherId)}</div>
                  <div className="field-hint" style={{ marginTop: 4 }}>
                    {loadingSlots
                      ? t('common:actions.loading')
                      : optSlots.length
                        ? optSlots.map(s => `${t('common:days.' + s.day)} ${fmt12Hour(s.time)} · ${roomName(rooms, s.roomId)}`).join(' · ')
                        : t('academics:courseDetailModal.noScheduleYet')}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {remaining == null ? (
                      <span className="pill pill-gray">{t('academics:courseDetailModal.openSeats')}</span>
                    ) : isFull ? (
                      <span className="pill pill-amber">{t('academics:courseDetailModal.full')}</span>
                    ) : (
                      <span className="pill pill-gray">{t('academics:courseDetailModal.seatsRemaining', { count: remaining })}</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  {status === 'enrolled' && <span className="pill pill-green">{t('academics:catalogPage.enrolled')}</span>}
                  {status === 'waitlisted' && <span className="pill pill-amber">{t('academics:catalogPage.waitlisted')}</span>}
                  {!status && (
                    <button
                      className={'btn-sm' + (registeringId === opt.id && loading ? ' btn-loading' : '')}
                      disabled={disabled}
                      onClick={() => handleRegister(opt.id)}
                      title={reason || undefined}
                    >
                      {registeringId === opt.id && loading
                        ? <span className="spinner"></span>
                        : (isFull ? t('academics:courseDetailModal.joinWaitlist') : t('academics:catalogPage.register'))}
                    </button>
                  )}
                  {!status && reason && <div className="field-hint" style={{ marginTop: 6, maxWidth: 180, color: 'var(--warning)' }}>{reason}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
      </div>
    </>
  );
}
