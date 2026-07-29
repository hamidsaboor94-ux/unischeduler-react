import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useNavigation } from '../../context/NavigationContext.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import {
  fetchCourseAssignments, saveAssignment, fetchAssignmentSubmissions, gradeSubmission,
  fetchCourseAnnouncements, saveAnnouncement, downloadSubmissionFile,
  fetchCourseMaterials, saveMaterial, downloadMaterialFile, deleteMaterial,
} from '../../api.js';
import { fmtDate } from '../../utils.js';

function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** One assignment row in the faculty quick-actions card — collapsed shows title/due date/
    submission count; expanded lazy-loads the roster-wide submissions list (file download,
    marks + feedback entry) for that assignment only. */
function AssignmentRow({ assignment, onGraded }) {
  const { t } = useTranslation(['academics', 'common']);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState({}); // studentId -> { marksAwarded, feedback }
  const { run: runSave, loading: saving } = useAsyncAction();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows === null) {
      setLoading(true);
      fetchAssignmentSubmissions(assignment.id)
        .then(res => setRows(res.rows))
        .catch(err => toast(err.message, 'error'))
        .finally(() => setLoading(false));
    }
  }

  function draftFor(studentId, submission) {
    return drafts[studentId] ?? { marksAwarded: submission?.marksAwarded ?? '', feedback: submission?.feedback ?? '' };
  }

  async function handleSaveGrade(studentId) {
    const draft = draftFor(studentId, rows.find(r => r.studentId === studentId)?.submission);
    try {
      await runSave(gradeSubmission(assignment.id, studentId, { marksAwarded: draft.marksAwarded, feedback: draft.feedback }));
      const res = await fetchAssignmentSubmissions(assignment.id);
      setRows(res.rows);
      onGraded();
      toast(t('academics:assignmentsPanel.marksSaved'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="roster-row" style={{ cursor: 'pointer', background: 'transparent', padding: '2px 0' }} onClick={toggle}>
        <span>
          <i className={'ti ' + (open ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" style={{ marginInlineEnd: 6 }}></i>
          <strong>{assignment.title}</strong>
          {assignment.description && <span className="field-hint" style={{ marginInlineStart: 8 }}>{assignment.description}</span>}
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {assignment.dueDate && <span className="pill pill-gray">{t('academics:assignmentsPanel.due', { date: fmtDate(assignment.dueDate) })}</span>}
          {assignment.maxMarks != null && <span className="pill pill-gray">{t('academics:assignmentsPanel.maxMarks', { n: assignment.maxMarks })}</span>}
          <span className="pill pill-blue">{t('academics:assignmentsPanel.submittedCount', { count: assignment.submittedCount, total: assignment.totalEnrolled })}</span>
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          {loading && <div className="field-hint">{t('common:actions.loading')}</div>}
          {!loading && rows && (
            <table className="data-table">
              <thead><tr>
                <th>{t('academics:submissionsPanel.student')}</th>
                <th>{t('academics:submissionsPanel.status')}</th>
                <th>{t('academics:submissionsPanel.marks')}</th>
                <th>{t('academics:submissionsPanel.feedback')}</th>
                <th></th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const draft = draftFor(r.studentId, r.submission);
                  return (
                    <tr key={r.studentId}>
                      <td>{r.idNumber ? `${r.idNumber} — ` : ''}{r.name}</td>
                      <td>
                        {r.submission
                          ? <span className="pill pill-green">{t('academics:submissionsPanel.submittedAt', { date: fmtDateTime(r.submission.submittedAt) })}</span>
                          : <span className="pill pill-gray">{t('academics:submissionsPanel.notSubmitted')}</span>}
                        {r.submission?.fileName && (
                          <button className="icon-btn" style={{ marginInlineStart: 4 }} title={r.submission.fileName}
                            onClick={() => downloadSubmissionFile(assignment.id, r.studentId, r.submission.fileName).catch(err => toast(err.message, 'error'))}>
                            <i className="ti ti-download" aria-hidden="true"></i>
                          </button>
                        )}
                      </td>
                      <td>
                        {r.submission ? (
                          <input type="number" min="0" max={assignment.maxMarks ?? undefined} style={{ width: 64, padding: '4px 6px', fontSize: 11 }}
                            value={draft.marksAwarded}
                            onChange={e => setDrafts(prev => ({ ...prev, [r.studentId]: { ...draft, marksAwarded: e.target.value } }))} />
                        ) : '—'}
                      </td>
                      <td>
                        {r.submission ? (
                          <input type="text" style={{ width: 140, padding: '4px 6px', fontSize: 11 }}
                            value={draft.feedback}
                            onChange={e => setDrafts(prev => ({ ...prev, [r.studentId]: { ...draft, feedback: e.target.value } }))} />
                        ) : '—'}
                      </td>
                      <td>
                        {r.submission && (
                          <button className={'btn-sm' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={() => handleSaveGrade(r.studentId)}>
                            {saving ? <span className="spinner"></span> : t('common:actions.save')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** Faculty course quick-actions card, opened by clicking a course card on the (faculty) Timetable
    view — assignments (with a live submissions/grading view), a jump into Attendance, a jump into
    Gradebook, announcements, roster, and materials (no dedicated card-icon of its own — this is
    the only place a faculty member can post one). `prefill.autoOpenAssignment` (set by the
    Timetable card's "Assign" quick action) pre-expands the Add Assignment form on open. */
export default function CourseActionsModal({ editId: courseId, prefill }) {
  const { t } = useTranslation(['academics', 'timetable', 'common']);
  const { courses } = useAppData();
  const { closeModal, openModal, confirmAction } = useModal();
  const { showSection } = useNavigation();
  const { toast } = useToast();
  const { run: runSave, loading: savingAssignment } = useAsyncAction();
  const { run: runPost, loading: postingAnnouncement } = useAsyncAction();
  const { run: runPostMaterial, loading: postingMaterial } = useAsyncAction();

  const course = courses.find(c => c.id === courseId);

  const [activeTab, setActiveTab] = useState('assignments');

  const [assignments, setAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [showAddForm, setShowAddForm] = useState(!!prefill?.autoOpenAssignment);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [maxMarks, setMaxMarks] = useState('');

  const [announcements, setAnnouncements] = useState([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [announcementText, setAnnouncementText] = useState('');

  const [materials, setMaterials] = useState([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialFile, setMaterialFile] = useState(null);

  function loadAssignments() {
    setLoadingAssignments(true);
    fetchCourseAssignments(courseId).then(setAssignments).catch(err => toast(err.message, 'error')).finally(() => setLoadingAssignments(false));
  }
  function loadAnnouncements() {
    setLoadingAnnouncements(true);
    fetchCourseAnnouncements(courseId).then(setAnnouncements).catch(err => toast(err.message, 'error')).finally(() => setLoadingAnnouncements(false));
  }
  function loadMaterials() {
    setLoadingMaterials(true);
    fetchCourseMaterials(courseId).then(setMaterials).catch(err => toast(err.message, 'error')).finally(() => setLoadingMaterials(false));
  }

  useEffect(() => {
    loadAssignments();
    loadAnnouncements();
    loadMaterials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function handleAddAssignment() {
    if (!title.trim()) { toast(t('academics:assignmentsPanel.titleRequired'), 'warning'); return; }
    if (!dueDate) { toast(t('academics:assignmentsPanel.dueDateRequired'), 'warning'); return; }
    try {
      await runSave(saveAssignment({ courseId, title: title.trim(), description: description.trim(), dueDate, maxMarks: maxMarks || null }));
      setTitle(''); setDescription(''); setDueDate(''); setMaxMarks(''); setShowAddForm(false);
      loadAssignments();
      toast(t('academics:assignmentsPanel.posted'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handlePostAnnouncement() {
    if (!announcementText.trim()) { toast(t('academics:announcementsPanel.messageRequired'), 'warning'); return; }
    try {
      await runPost(saveAnnouncement({ courseId, message: announcementText.trim() }));
      setAnnouncementText('');
      loadAnnouncements();
      toast(t('academics:announcementsPanel.posted'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handlePostMaterial() {
    if (!materialTitle.trim()) { toast(t('academics:materialsPanel.titleRequired'), 'warning'); return; }
    if (!materialFile) { toast(t('academics:materialsPanel.fileRequired'), 'warning'); return; }
    try {
      await runPostMaterial(saveMaterial({ courseId, title: materialTitle.trim(), file: materialFile }));
      setMaterialTitle(''); setMaterialFile(null);
      loadMaterials();
      toast(t('academics:materialsPanel.posted'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /** Mirrors RosterModal's removeStudent — this app shows one modal at a time, so confirming a
      destructive action means closing the current one first, then the shared confirm dialog runs
      the deletion on accept. Faculty reopens this course card afterward to see the updated list. */
  function handleDeleteMaterial(m) {
    closeModal();
    confirmAction(
      t('academics:materialsPanel.deleteConfirm', { title: m.title }),
      () => deleteMaterial(m.id).then(() => toast(t('academics:materialsPanel.deleted'))).catch(err => toast(err.message, 'error'))
    );
  }

  function goTo(section) {
    closeModal();
    showSection(section, { courseId });
  }

  if (!course) return null;

  return (
    <>
    <div id="modal-body">
      {/* Attendance / Marks / Roster — one-shot shortcuts (navigate away or open another modal),
          not content of their own, so they stay outside the tabs rather than becoming a 4th one. */}
      <div className="course-action-tiles" style={{ marginBottom: 14 }}>
        <button className="course-action-tile blue" onClick={() => goTo('attendance')}>
          <i className="ti ti-clipboard-check course-action-tile-icon" aria-hidden="true"></i>
          <span className="course-action-tile-label">{t('timetable:courseActionsModal.takeAttendance')}</span>
          <span className="course-action-tile-hint">{t('timetable:courseActionsModal.takeAttendanceHint')}</span>
        </button>
        <button className="course-action-tile green" onClick={() => goTo('gradebook')}>
          <i className="ti ti-report-analytics course-action-tile-icon" aria-hidden="true"></i>
          <span className="course-action-tile-label">{t('timetable:courseActionsModal.enterMarks')}</span>
          <span className="course-action-tile-hint">{t('timetable:courseActionsModal.enterMarksHint')}</span>
        </button>
        <button className="course-action-tile amber" onClick={() => openModal('roster', courseId)}>
          <i className="ti ti-users course-action-tile-icon" aria-hidden="true"></i>
          <span className="course-action-tile-label">{t('timetable:courseActionsModal.viewRoster')}</span>
          <span className="course-action-tile-hint">{t('timetable:courseActionsModal.viewRosterHint')}</span>
        </button>
      </div>

      {/* Assignments / Announcements / Materials each get their own space instead of one long
          stack — only the active tab's panel renders. */}
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={'tab' + (activeTab === 'assignments' ? ' active' : '')} onClick={() => setActiveTab('assignments')}>
          {t('timetable:courseActionsModal.assignments')}
        </button>
        <button className={'tab' + (activeTab === 'announcements' ? ' active' : '')} onClick={() => setActiveTab('announcements')}>
          {t('timetable:courseActivityModal.announcements')}
        </button>
        <button className={'tab' + (activeTab === 'materials' ? ' active' : '')} onClick={() => setActiveTab('materials')}>
          {t('academics:materialsPanel.title')}
        </button>
      </div>

      {activeTab === 'assignments' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('timetable:courseActionsModal.assignments')}</div>
              <div className="panel-subtitle">{t('academics:assignmentsPanel.hint')}</div>
            </div>
            <button className="btn-sm" onClick={() => setShowAddForm(v => !v)}>
              <i className="ti ti-plus"></i> {t('academics:assignmentsPanel.addAssignment')}
            </button>
          </div>

          {showAddForm && (
            <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
              <div className="form-row">
                <div className="form-label">{t('academics:assignmentsPanel.title')}</div>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div className="form-row">
                <div className="form-label">{t('academics:assignmentsPanel.description')}</div>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div className="form-row-2">
                <div className="form-row">
                  <div className="form-label">{t('academics:assignmentsPanel.dueDate')}</div>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-label">{t('academics:assignmentsPanel.maxMarksLabel')}</div>
                  <input type="number" min="1" value={maxMarks} onChange={e => setMaxMarks(e.target.value)} />
                </div>
              </div>
              <button className={'btn-primary' + (savingAssignment ? ' btn-loading' : '')} disabled={savingAssignment} onClick={handleAddAssignment}>
                {savingAssignment ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('academics:assignmentsPanel.post')}</>}
              </button>
            </div>
          )}

          {loadingAssignments && <div className="field-hint">{t('common:actions.loading')}</div>}
          {!loadingAssignments && !assignments.length && <div className="field-hint">{t('academics:assignmentsPanel.empty')}</div>}
          {assignments.map(a => <AssignmentRow key={a.id} assignment={a} onGraded={loadAssignments} />)}
        </div>
      )}

      {activeTab === 'announcements' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('timetable:courseActionsModal.postAnnouncement')}</div>
              <div className="panel-subtitle">{t('academics:announcementsPanel.hint')}</div>
            </div>
          </div>
          <div className="form-row">
            <textarea rows={2} value={announcementText} onChange={e => setAnnouncementText(e.target.value)}
              placeholder={t('academics:announcementsPanel.placeholder')} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          <button className={'btn-primary' + (postingAnnouncement ? ' btn-loading' : '')} disabled={postingAnnouncement} onClick={handlePostAnnouncement}>
            {postingAnnouncement ? <span className="spinner"></span> : <><i className="ti ti-send"></i> {t('academics:announcementsPanel.post')}</>}
          </button>

          <div style={{ marginTop: 12 }}>
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
        </div>
      )}

      {activeTab === 'materials' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('academics:materialsPanel.title')}</div>
              <div className="panel-subtitle">{t('academics:materialsPanel.hint')}</div>
            </div>
          </div>
          <div className="form-row-2">
            <div className="form-row">
              <div className="form-label">{t('academics:materialsPanel.materialTitle')}</div>
              <input type="text" value={materialTitle} onChange={e => setMaterialTitle(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-label">{t('academics:materialsPanel.file')}</div>
              <input type="file" onChange={e => setMaterialFile(e.target.files[0] || null)} />
            </div>
          </div>
          <button className={'btn-primary' + (postingMaterial ? ' btn-loading' : '')} disabled={postingMaterial} onClick={handlePostMaterial}>
            {postingMaterial ? <span className="spinner"></span> : <><i className="ti ti-upload"></i> {t('academics:materialsPanel.post')}</>}
          </button>

          <div style={{ marginTop: 12 }}>
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
                    <button className="icon-btn danger" aria-label={t('academics:materialsPanel.deleteAriaLabel', { title: m.title })} onClick={() => handleDeleteMaterial(m)}>
                      <i className="ti ti-trash" aria-hidden="true"></i>
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
    <div id="modal-footer" className="modal-footer">
      <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
    </div>
    </>
  );
}
