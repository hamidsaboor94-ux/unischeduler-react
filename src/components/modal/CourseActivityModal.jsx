import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { fetchCourseAssignments, fetchCourseAnnouncements, submitAssignment, fetchCourseMaterials, downloadMaterialFile } from '../../api.js';
import { fmtDate } from '../../utils.js';

function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** One assignment as seen by an enrolled student — status line plus an inline submit/resubmit
    form (file and/or a short text response). */
function AssignmentCard({ assignment, onSubmitted }) {
  const { t } = useTranslation(['academics', 'common']);
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const [file, setFile] = useState(null);
  const [textResponse, setTextResponse] = useState('');

  const sub = assignment.mySubmission;

  async function handleSubmit() {
    if (!file && !textResponse.trim()) { toast(t('academics:submissionsPanel.attachSomething'), 'warning'); return; }
    try {
      await run(submitAssignment(assignment.id, { file, textResponse: textResponse.trim() }));
      setFile(null);
      setTextResponse('');
      toast(t('academics:submissionsPanel.submitted'));
      onSubmitted();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="panel-header">
        <div>
          <div className="panel-title">{assignment.title}</div>
          {assignment.description && <div className="panel-subtitle">{assignment.description}</div>}
        </div>
        <span style={{ display: 'flex', gap: 6 }}>
          {assignment.dueDate && <span className="pill pill-gray">{t('academics:assignmentsPanel.due', { date: fmtDate(assignment.dueDate) })}</span>}
          {assignment.maxMarks != null && <span className="pill pill-gray">{t('academics:assignmentsPanel.maxMarks', { n: assignment.maxMarks })}</span>}
        </span>
      </div>

      {sub?.marksAwarded != null ? (
        <span className="pill pill-green">{t('academics:submissionsPanel.graded', { marks: sub.marksAwarded, max: assignment.maxMarks ?? '—' })}</span>
      ) : sub ? (
        <span className="pill pill-blue">{t('academics:submissionsPanel.submittedAt', { date: fmtDateTime(sub.submittedAt) })}</span>
      ) : (
        <span className="pill pill-gray">{t('academics:submissionsPanel.notSubmitted')}</span>
      )}
      {sub?.feedback && <div className="field-hint" style={{ marginTop: 6 }}>{t('academics:submissionsPanel.feedbackLabel')}: {sub.feedback}</div>}

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <div className="form-row">
          <input type="file" onChange={e => setFile(e.target.files[0] || null)} />
        </div>
        <div className="form-row">
          <textarea rows={2} value={textResponse} onChange={e => setTextResponse(e.target.value)}
            placeholder={t('academics:submissionsPanel.textResponsePlaceholder')} style={{ width: '100%', resize: 'vertical' }} />
        </div>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleSubmit}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-upload"></i> {sub ? t('academics:submissionsPanel.resubmit') : t('academics:submissionsPanel.submit')}</>}
        </button>
      </div>
    </div>
  );
}

/** Student-facing course activity card, opened by clicking a course card on My Schedule (or its
    Assignments/Materials quick actions) — lists assignments (with a submit/resubmit form),
    announcements, and materials, and marks the course's activity as viewed on open so its
    "unviewed" dot clears immediately. `prefill.focus === 'materials'` (set by the Materials
    quick action) scrolls straight to that section on open. */
export default function CourseActivityModal({ editId: courseId, prefill }) {
  const { t } = useTranslation(['academics', 'timetable', 'common']);
  const { courses, markCourseActivityViewed } = useAppData();
  const { closeModal } = useModal();
  const { toast } = useToast();
  const materialsRef = useRef(null);

  const course = courses.find(c => c.id === courseId);

  const [assignments, setAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);

  function loadAssignments() {
    setLoadingAssignments(true);
    fetchCourseAssignments(courseId).then(setAssignments).catch(err => toast(err.message, 'error')).finally(() => setLoadingAssignments(false));
  }

  useEffect(() => {
    loadAssignments();
    setLoadingAnnouncements(true);
    fetchCourseAnnouncements(courseId).then(setAnnouncements).catch(err => toast(err.message, 'error')).finally(() => setLoadingAnnouncements(false));
    setLoadingMaterials(true);
    fetchCourseMaterials(courseId).then(setMaterials).catch(err => toast(err.message, 'error')).finally(() => setLoadingMaterials(false));
    markCourseActivityViewed(courseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  useEffect(() => {
    if (prefill?.focus === 'materials' && materialsRef.current) {
      materialsRef.current.scrollIntoView({ block: 'start' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  if (!course) return null;

  return (
    <>
    <div id="modal-body">
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">{t('timetable:courseActivityModal.announcements')}</div>
          </div>
        </div>
        {loadingAnnouncements && <div className="field-hint">{t('common:actions.loading')}</div>}
        {!loadingAnnouncements && !announcements.length && <div className="field-hint">{t('academics:announcementsPanel.empty')}</div>}
        <div className="roster-list">
          {announcements.map(an => (
            <div className="roster-row" key={an.id} style={{ alignItems: 'flex-start' }}>
              <span>{an.message}</span>
              <span className="field-hint" style={{ whiteSpace: 'nowrap', marginInlineStart: 8 }}>{fmtDateTime(an.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-title" style={{ margin: '14px 4px 8px' }}>{t('timetable:courseActivityModal.assignments')}</div>
      {loadingAssignments && <div className="field-hint">{t('common:actions.loading')}</div>}
      {!loadingAssignments && !assignments.length && <div className="field-hint">{t('academics:assignmentsPanel.empty')}</div>}
      {assignments.map(a => <AssignmentCard key={a.id} assignment={a} onSubmitted={loadAssignments} />)}

      <div className="panel" ref={materialsRef} style={{ marginTop: 14 }}>
        <div className="panel-header">
          <div>
            <div className="panel-title">{t('timetable:courseActivityModal.materials')}</div>
          </div>
        </div>
        {loadingMaterials && <div className="field-hint">{t('common:actions.loading')}</div>}
        {!loadingMaterials && !materials.length && <div className="field-hint">{t('academics:materialsPanel.empty')}</div>}
        <div className="roster-list">
          {materials.map(m => (
            <div className="roster-row" key={m.id}>
              <span>{m.title}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="field-hint" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.createdAt)}</span>
                <button className="icon-btn" title={m.fileName} onClick={() => downloadMaterialFile(m.id, m.fileName).catch(err => toast(err.message, 'error'))}>
                  <i className="ti ti-download" aria-hidden="true"></i>
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
    <div id="modal-footer" className="modal-footer">
      <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
    </div>
    </>
  );
}
