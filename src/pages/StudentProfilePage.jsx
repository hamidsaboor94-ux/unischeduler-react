import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import {
  fetchStudentProfile, updateMyStudentProfile, updateStudentProfile,
  uploadStudentDocument, downloadStudentDocument, deleteStudentDocument,
  fetchProgressionHistory, fetchCurrentProgression, evaluateProgression, overrideProgression,
  downloadGraduationCertificate,
} from '../api.js';
import { can } from '../permissions.js';
import { fmtDate, isForbidden } from '../utils.js';
import { StatCard } from '../components/ui/StatCard.jsx';
import StudentPhotoUpload from '../components/StudentPhotoUpload.jsx';

const NUMERIC_FIELDS = new Set(['entryTestMarks', 'advisorTeacherId', 'departmentId', 'programId', 'studentTypeId', 'previousGraduationYear']);
// Every student_profiles column an admin may edit — mirrors ADMIN_FIELDS in api/src/routes/studentProfile.js.
// programSemester/semesterStatus are deliberately excluded — those are driven by the Academic
// Progression panel below (automatic evaluation + its audited manual-override action), not a
// free-text field edit.
const ADMIN_FIELDS = [
  'fatherName', 'grandfatherName', 'gender', 'dateOfBirth', 'nationality', 'nationalId', 'passportNumber',
  'presentAddress', 'permanentAddress', 'mobileNumber', 'emergencyContact',
  'entryTestMarks', 'sponsor', 'specialization', 'advisorTeacherId', 'departmentId', 'programId', 'studentTypeId',
  'section', 'batch', 'admissionStatus', 'enrollmentStatus', 'studentStatus',
  'previousSchoolName', 'previousGraduationYear',
];
const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const ADMISSION_OPTIONS = ['Approved', 'Pending', 'Rejected'];
const ENROLLMENT_OPTIONS = ['Regular', 'Part-time', 'Probation', 'Withdrawn'];
const STUDENT_STATUS_OPTIONS = ['Active', 'Graduated', 'Suspended', 'Withdrawn', 'On Leave'];
const DOCUMENT_TYPES = ['ID Scan', 'Certificate', 'Transcript', 'Passport Copy', 'Other'];
const ADMISSION_PILL = { Approved: 'pill-green', Pending: 'pill-amber', Rejected: 'pill-red' };
const ENROLLMENT_PILL = { Regular: 'pill-green', 'Part-time': 'pill-blue', Probation: 'pill-amber', Withdrawn: 'pill-red' };
const STUDENT_STATUS_PILL = { Active: 'pill-green', Graduated: 'pill-blue', Suspended: 'pill-red', Withdrawn: 'pill-red', 'On Leave': 'pill-amber' };
const SEMESTER_STATUS_PILL = {
  'In Progress': 'pill-blue', 'Awaiting Results': 'pill-amber', Passed: 'pill-green', Failed: 'pill-red',
  'On Hold': 'pill-gray', 'Graduation Eligible': 'pill-green',
};
const OVERRIDE_STATUS_OPTIONS = ['In Progress', 'Awaiting Results', 'Passed', 'Failed', 'On Hold', 'Graduation Eligible'];

function formStateFromProfile(profile) {
  const state = {};
  for (const f of ADMIN_FIELDS) state[f] = profile?.[f] != null ? String(profile[f]) : '';
  return state;
}

/** A read/edit field row — .form-static in read mode (matches ProfileModal.jsx), the given
    input/select in edit mode. `display` is the pre-formatted read-mode text. */
function FieldRow({ label, display, editing, children }) {
  return (
    <div className="form-row">
      <div className="form-label">{label}</div>
      {editing ? children : <div className="form-static">{display}</div>}
    </div>
  );
}

export default function StudentProfilePage() {
  const { t } = useTranslation(['studentProfile', 'common']);
  const { currentUser, departments, teachers, programs, studentTypes } = useAppData();
  const { sectionFocus, showSection } = useNavigation();
  const { confirmAction } = useModal();
  const { toast } = useToast();
  const { run: runSaveAdmin, loading: savingAdmin } = useAsyncAction();
  const { run: runSaveSelf, loading: savingSelf } = useAsyncAction();
  const { run: runUpload, loading: uploading } = useAsyncAction();
  const { run: runEvaluate, loading: evaluating } = useAsyncAction();
  const { run: runOverride, loading: overriding } = useAsyncAction();
  const { run: runDownloadCert, loading: downloadingCert } = useAsyncAction();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [adminEditing, setAdminEditing] = useState(false);
  const [selfEditing, setSelfEditing] = useState(false);
  const [adminForm, setAdminForm] = useState({});
  const [selfForm, setSelfForm] = useState({ mobileNumber: '', emergencyContact: '' });
  const [docType, setDocType] = useState(DOCUMENT_TYPES[0]);
  const [docTitle, setDocTitle] = useState('');
  const docFileRef = useRef(null);
  const [progressionHistory, setProgressionHistory] = useState([]);
  const [progressionCurrent, setProgressionCurrent] = useState(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ semesterNumber: '', status: '', reason: '' });

  const na = t('common:notApplicable');
  const isAdmin = currentUser.role === 'admin';
  const isStudentSelf = currentUser.role === 'student';
  const canProgress = can(currentUser.role, 'students', 'write');
  // A student sees their own profile; any staff member who navigated here with a
  // specific student (admin from Users, advisor from My Advisees) sees that one.
  // The backend decides who's actually allowed — an advisor only loads their own
  // advisees, others 403 — so widening this beyond admin never leaks data.
  const viewingStudentId = isStudentSelf
    ? currentUser.id
    : (sectionFocus?.section === 'student-profile' && sectionFocus.studentId != null)
      ? Number(sectionFocus.studentId)
      : null;

  // Every page in this app stays mounted at all times regardless of role (see AppShell.jsx) —
  // only fetch when there's an actual student to show (self, or an admin who navigated here via
  // a specific student), otherwise faculty/other cases would silently 403 on mount.
  useEffect(() => {
    if (!viewingStudentId || (!isAdmin && !isStudentSelf)) { setData(null); setForbidden(false); return; }
    setLoading(true);
    setForbidden(false);
    setAdminEditing(false);
    setSelfEditing(false);
    setOverrideOpen(false);
    Promise.all([fetchStudentProfile(viewingStudentId), fetchProgressionHistory(viewingStudentId), fetchCurrentProgression(viewingStudentId)])
      .then(([d, history, current]) => {
        setData(d);
        setAdminForm(formStateFromProfile(d.profile));
        setSelfForm({ mobileNumber: d.profile.mobileNumber || '', emergencyContact: d.profile.emergencyContact || '' });
        setProgressionHistory(history);
        setProgressionCurrent(current);
        // The Students page's "Edit" quick action navigates here with autoEdit — jump straight
        // into edit mode instead of making the admin click Edit again.
        if (isAdmin && sectionFocus?.autoEdit) setAdminEditing(true);
      })
      .catch(err => {
        // See StudentDetailPage.jsx for why a 403 gets its own state instead of a toast.
        if (isForbidden(err)) { setForbidden(true); return; }
        toast(err.message, 'error');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingStudentId, sectionFocus?.autoEdit]);

  async function refresh() {
    const [fresh, history, current] = await Promise.all([
      fetchStudentProfile(viewingStudentId), fetchProgressionHistory(viewingStudentId), fetchCurrentProgression(viewingStudentId),
    ]);
    setData(fresh);
    setAdminForm(formStateFromProfile(fresh.profile));
    setSelfForm({ mobileNumber: fresh.profile.mobileNumber || '', emergencyContact: fresh.profile.emergencyContact || '' });
    setProgressionHistory(history);
    setProgressionCurrent(current);
  }

  async function handleEvaluate() {
    try {
      const result = await runEvaluate(evaluateProgression(viewingStudentId));
      await refresh();
      if (result.status === 'Awaiting Results') toast(t('studentProfile:progression.toasts.awaitingResults'), 'info');
      else if (result.status === 'Failed') toast(t('studentProfile:progression.toasts.failed'), 'warning');
      else if (result.graduationEligible) toast(t('studentProfile:progression.toasts.graduationEligible'));
      else if (result.advanced) toast(t('studentProfile:progression.toasts.advanced', { semester: result.semesterNumber }));
      else toast(t('studentProfile:progression.toasts.noChange'), 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleOverride() {
    if (!overrideForm.reason.trim()) { toast(t('studentProfile:progression.override.errors.reasonRequired'), 'warning'); return; }
    try {
      await runOverride(overrideProgression(viewingStudentId, {
        semesterNumber: overrideForm.semesterNumber ? Number(overrideForm.semesterNumber) : undefined,
        status: overrideForm.status || undefined,
        reason: overrideForm.reason.trim(),
      }));
      await refresh();
      setOverrideOpen(false);
      setOverrideForm({ semesterNumber: '', status: '', reason: '' });
      toast(t('studentProfile:progression.toasts.overridden'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleDownloadCertificate() {
    try {
      await runDownloadCert(downloadGraduationCertificate(viewingStudentId, `certificate-${data?.student?.idNumber || viewingStudentId}.pdf`));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleSaveAdmin() {
    const payload = {};
    for (const f of ADMIN_FIELDS) {
      const raw = adminForm[f];
      payload[f] = raw === '' ? null : (NUMERIC_FIELDS.has(f) ? Number(raw) : raw);
    }
    try {
      await runSaveAdmin(updateStudentProfile(viewingStudentId, payload));
      await refresh();
      setAdminEditing(false);
      toast(t('studentProfile:toasts.saved'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleSaveSelf() {
    try {
      await runSaveSelf(updateMyStudentProfile({
        mobileNumber: selfForm.mobileNumber || null,
        emergencyContact: selfForm.emergencyContact || null,
      }));
      await refresh();
      setSelfEditing(false);
      toast(t('studentProfile:toasts.contactSaved'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleUploadDocument() {
    const file = docFileRef.current?.files?.[0];
    if (!docTitle.trim()) { toast(t('studentProfile:documents.errors.titleRequired'), 'warning'); return; }
    if (!file) { toast(t('studentProfile:documents.errors.fileRequired'), 'warning'); return; }
    try {
      await runUpload(uploadStudentDocument(viewingStudentId, { documentType: docType, title: docTitle.trim(), file }));
      await refresh();
      setDocTitle('');
      if (docFileRef.current) docFileRef.current.value = '';
      toast(t('studentProfile:documents.toasts.uploaded'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleDeleteDocument(doc) {
    confirmAction(t('studentProfile:documents.confirmDelete', { title: doc.title }), async () => {
      try {
        await deleteStudentDocument(doc.id);
        await refresh();
        toast(t('studentProfile:documents.toasts.deleted'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  if (!viewingStudentId) {
    return (
      <Section name="student-profile">
        <div className="topbar">
          <i className="ti ti-id-badge-2" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
          <h2>{t('studentProfile:title')}</h2>
        </div>
        <div id="content">
          <div className="field-hint" style={{ padding: 14 }}>{t('studentProfile:noStudentSelected')}</div>
        </div>
      </Section>
    );
  }

  return (
    <Section name="student-profile">
      <div className="topbar">
        <i className="ti ti-id-badge-2" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('studentProfile:title')}</h2>
        <div className="topbar-actions no-print">
          <button className="btn-sm" onClick={() => window.print()}><i className="ti ti-printer"></i> {t('studentProfile:print')}</button>
        </div>
      </div>
      <div id="content">
        {loading && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
        {!loading && forbidden && <div className="field-hint" style={{ padding: 14 }}>{t('common:accessDenied')}</div>}
        {!loading && !forbidden && !data && <div className="field-hint" style={{ padding: 14 }}>{t('studentProfile:notFound')}</div>}
        {!loading && data && (() => {
          const { student, profile, department, program, studentType, advisor, activeTerm, gpa, completedCredits, requiredCredits, documents, graduationRecord } = data;
          const pct = requiredCredits ? Math.min(100, Math.round((completedCredits / requiredCredits) * 100)) : 0;
          const admissionYear = profile.enrollmentDate ? profile.enrollmentDate.slice(0, 4) : null;
          const semesterStatus = profile.semesterStatus || 'In Progress';
          const openTermName = progressionCurrent?.term?.name;
          const currentFailedCount = progressionCurrent?.courses?.filter(c => c.grade === 'F').length || 0;
          return (
            <>
              <div className="panel profile-header-panel">
                <StudentPhotoUpload studentId={student.id} name={student.name || student.email} photoPath={profile.photoPath} canWrite={isAdmin} onUploaded={refresh} size="lg" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="profile-header-name">{student.name || na}</div>
                  <div className="profile-header-meta">
                    {student.idNumber && <span className="pill pill-gray">{student.idNumber}</span>}
                    {profile.admissionStatus && <span className={'pill ' + (ADMISSION_PILL[profile.admissionStatus] || 'pill-gray')}>{t(`studentProfile:admissionOptions.${profile.admissionStatus}`)}</span>}
                    {profile.enrollmentStatus && <span className={'pill ' + (ENROLLMENT_PILL[profile.enrollmentStatus] || 'pill-gray')}>{t(`studentProfile:enrollmentOptions.${profile.enrollmentStatus}`)}</span>}
                    {profile.studentStatus && <span className={'pill ' + (STUDENT_STATUS_PILL[profile.studentStatus] || 'pill-gray')}>{t(`studentProfile:studentStatusOptions.${profile.studentStatus}`)}</span>}
                  </div>
                  <div className="field-hint" style={{ margin: '4px 0 0' }}>{t('studentProfile:memberSince', { date: (student.createdAt || '').split(' ')[0] || na })}</div>
                  {profile.studentStatus === 'Graduated' && (
                    <div className="field-hint" style={{ margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span>
                        {t('studentProfile:graduation.conferredLine', {
                          degree: profile.degreeAwarded || na,
                          date: profile.graduationDate ? fmtDate(profile.graduationDate) : na,
                        })}
                      </span>
                      <button className={'btn-sm no-print' + (downloadingCert ? ' btn-loading' : '')} disabled={downloadingCert} onClick={handleDownloadCertificate}>
                        {downloadingCert ? <span className="spinner"></span> : <><i className="ti ti-certificate"></i> {t('studentProfile:graduation.downloadCertificate')}</>}
                      </button>
                      {graduationRecord && can(currentUser.role, 'graduation', 'read') && (
                        <button className="btn-sm no-print" onClick={() => showSection('graduates-registry', { graduateId: graduationRecord.id })}>
                          <i className="ti ti-external-link"></i> Official graduate record
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isAdmin && !adminEditing && (
                  <button className="btn-sm no-print" onClick={() => setAdminEditing(true)}><i className="ti ti-pencil"></i> {t('studentProfile:editProfile')}</button>
                )}
                {isAdmin && adminEditing && (
                  <div className="no-print" style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-sm" onClick={() => { setAdminEditing(false); setAdminForm(formStateFromProfile(profile)); }}>{t('common:actions.cancel')}</button>
                    <button className={'btn-primary' + (savingAdmin ? ' btn-loading' : '')} disabled={savingAdmin} onClick={handleSaveAdmin}>
                      {savingAdmin ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
                    </button>
                  </div>
                )}
              </div>

              {/* --- Academic Progression --- */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title">{t('studentProfile:progression.title')}</div>
                  {canProgress && (
                    <div className="no-print" style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-sm" onClick={() => setOverrideOpen(o => !o)}>
                        <i className="ti ti-adjustments"></i> {t('studentProfile:progression.override.toggle')}
                      </button>
                      <button className={'btn-sm' + (evaluating ? ' btn-loading' : '')} disabled={evaluating} onClick={handleEvaluate}>
                        {evaluating ? <span className="spinner"></span> : <><i className="ti ti-refresh"></i> {t('studentProfile:progression.evaluate')}</>}
                      </button>
                    </div>
                  )}
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.programSemester')} display={profile.programSemester ?? na} editing={false} />
                  <FieldRow label={t('studentProfile:progression.fields.academicYear')} display={openTermName || activeTerm?.name || na} editing={false} />
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:progression.fields.admissionYear')} display={admissionYear || na} editing={false} />
                  <FieldRow
                    label={t('studentProfile:progression.fields.semesterStatus')}
                    display={<span className={'pill ' + (SEMESTER_STATUS_PILL[semesterStatus] || 'pill-gray')}>{t(`studentProfile:semesterStatusOptions.${semesterStatus}`, semesterStatus)}</span>}
                    editing={false}
                  />
                </div>
                <div className="stat-grid" style={{ marginTop: 14, marginBottom: 0 }}>
                  <StatCard icon="ti-school" hue="indigo" label={t('studentProfile:fields.gpa')}
                    value={gpa != null ? t('studentProfile:gpaScale', { gpa: gpa.toFixed(2) }) : t('studentProfile:gpaNotAvailable')} />
                  <StatCard icon="ti-report" hue="teal"
                    label={t('studentProfile:progression.fields.credits')}
                    value={progressionCurrent ? `${progressionCurrent.creditsEarned} / ${progressionCurrent.creditsAttempted}` : '—'}
                    sub={progressionCurrent ? t('studentProfile:progression.fields.gradedProgress', { graded: progressionCurrent.gradedCount, total: progressionCurrent.totalCount }) : undefined}
                  />
                  <StatCard icon="ti-alert-triangle" hue={currentFailedCount ? 'red' : 'indigo'}
                    label={t('studentProfile:progression.fields.failedCourses')}
                    value={currentFailedCount} />
                </div>
                {canProgress && overrideOpen && (
                  <div className="no-print" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                    <div className="form-row-2">
                      <FieldRow label={t('studentProfile:progression.override.semesterNumber')} editing>
                        <input type="number" min="1" placeholder={String(profile.programSemester ?? 1)}
                          value={overrideForm.semesterNumber} onChange={e => setOverrideForm(f => ({ ...f, semesterNumber: e.target.value }))} />
                      </FieldRow>
                      <FieldRow label={t('studentProfile:progression.override.status')} editing>
                        <select value={overrideForm.status} onChange={e => setOverrideForm(f => ({ ...f, status: e.target.value }))}>
                          <option value="">{t('studentProfile:select')}</option>
                          {OVERRIDE_STATUS_OPTIONS.map(v => <option key={v} value={v}>{t(`studentProfile:semesterStatusOptions.${v}`, v)}</option>)}
                        </select>
                      </FieldRow>
                    </div>
                    <FieldRow label={t('studentProfile:progression.override.reason')} editing>
                      <textarea rows={2} value={overrideForm.reason} onChange={e => setOverrideForm(f => ({ ...f, reason: e.target.value }))}
                        placeholder={t('studentProfile:progression.override.reasonPlaceholder')} />
                    </FieldRow>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn-sm" onClick={() => { setOverrideOpen(false); setOverrideForm({ semesterNumber: '', status: '', reason: '' }); }}>
                        {t('common:actions.cancel')}
                      </button>
                      <button className={'btn-primary' + (overriding ? ' btn-loading' : '')} disabled={overriding} onClick={handleOverride}>
                        {overriding ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('studentProfile:progression.override.submit')}</>}
                      </button>
                    </div>
                  </div>
                )}

                {progressionHistory.length > 0 && (
                  <table className="data-table" style={{ marginTop: 14 }}>
                    <thead><tr>
                      <th>{t('studentProfile:progression.history.semester')}</th>
                      <th>{t('studentProfile:progression.history.status')}</th>
                      <th>{t('studentProfile:progression.history.credits')}</th>
                      <th>{t('studentProfile:progression.history.gpa')}</th>
                      <th>{t('studentProfile:progression.history.completed')}</th>
                    </tr></thead>
                    <tbody>
                      {progressionHistory.map(rec => (
                        <tr key={rec.id}>
                          <td>{t('studentProfile:progression.history.semesterValue', { number: rec.semesterNumber })}</td>
                          <td><span className={'pill ' + (SEMESTER_STATUS_PILL[rec.status] || 'pill-gray')}>{t(`studentProfile:semesterStatusOptions.${rec.status}`, rec.status)}</span></td>
                          <td>{rec.creditsEarned ?? 0} / {rec.creditsAttempted ?? 0}</td>
                          <td>{rec.termGpa != null ? rec.termGpa.toFixed(2) : na}</td>
                          <td>{rec.completedAt ? (rec.completedAt.split(' ')[0]) : na}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* --- Personal Details --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('studentProfile:sections.personal')}</div></div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.studentId')} display={student.idNumber || na} editing={false} />
                  <FieldRow label={t('studentProfile:fields.fullName')} display={student.name || na} editing={false} />
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.fatherName')} display={profile.fatherName || na} editing={adminEditing}>
                    <input type="text" value={adminForm.fatherName} onChange={e => setAdminForm(f => ({ ...f, fatherName: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('studentProfile:fields.grandfatherName')} display={profile.grandfatherName || na} editing={adminEditing}>
                    <input type="text" value={adminForm.grandfatherName} onChange={e => setAdminForm(f => ({ ...f, grandfatherName: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.gender')} display={profile.gender ? t(`studentProfile:genderOptions.${profile.gender}`) : na} editing={adminEditing}>
                    <select value={adminForm.gender} onChange={e => setAdminForm(f => ({ ...f, gender: e.target.value }))}>
                      <option value="">{t('studentProfile:select')}</option>
                      {GENDER_OPTIONS.map(g => <option key={g} value={g}>{t(`studentProfile:genderOptions.${g}`)}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label={t('studentProfile:fields.dateOfBirth')} display={profile.dateOfBirth ? fmtDate(profile.dateOfBirth) : na} editing={adminEditing}>
                    <input type="date" value={adminForm.dateOfBirth} onChange={e => setAdminForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.nationality')} display={profile.nationality || na} editing={adminEditing}>
                    <input type="text" value={adminForm.nationality} onChange={e => setAdminForm(f => ({ ...f, nationality: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('studentProfile:fields.nationalId')} display={profile.nationalId || na} editing={adminEditing}>
                    <input type="text" value={adminForm.nationalId} onChange={e => setAdminForm(f => ({ ...f, nationalId: e.target.value }))} />
                  </FieldRow>
                </div>
                <FieldRow label={t('studentProfile:fields.passportNumber')} display={profile.passportNumber || na} editing={adminEditing}>
                  <input type="text" value={adminForm.passportNumber} onChange={e => setAdminForm(f => ({ ...f, passportNumber: e.target.value }))} />
                </FieldRow>
              </div>

              {/* --- Address Details --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('studentProfile:sections.address')}</div></div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.presentAddress')} display={profile.presentAddress || na} editing={adminEditing}>
                    <textarea rows={2} value={adminForm.presentAddress} onChange={e => setAdminForm(f => ({ ...f, presentAddress: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('studentProfile:fields.permanentAddress')} display={profile.permanentAddress || na} editing={adminEditing}>
                    <textarea rows={2} value={adminForm.permanentAddress} onChange={e => setAdminForm(f => ({ ...f, permanentAddress: e.target.value }))} />
                  </FieldRow>
                </div>
              </div>

              {/* --- Contact Details --- */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title">{t('studentProfile:sections.contact')}</div>
                  {isStudentSelf && !selfEditing && (
                    <button className="btn-sm no-print" onClick={() => setSelfEditing(true)}><i className="ti ti-pencil"></i> {t('studentProfile:editContact')}</button>
                  )}
                  {isStudentSelf && selfEditing && (
                    <div className="no-print" style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-sm" onClick={() => { setSelfEditing(false); setSelfForm({ mobileNumber: profile.mobileNumber || '', emergencyContact: profile.emergencyContact || '' }); }}>{t('common:actions.cancel')}</button>
                      <button className={'btn-primary' + (savingSelf ? ' btn-loading' : '')} disabled={savingSelf} onClick={handleSaveSelf}>
                        {savingSelf ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
                      </button>
                    </div>
                  )}
                </div>
                <div className="form-row-2">
                  <FieldRow
                    label={t('studentProfile:fields.mobileNumber')}
                    display={profile.mobileNumber || na}
                    editing={adminEditing || (isStudentSelf && selfEditing)}
                  >
                    <input
                      type="text"
                      value={isStudentSelf && selfEditing ? selfForm.mobileNumber : adminForm.mobileNumber}
                      onChange={e => (isStudentSelf && selfEditing
                        ? setSelfForm(f => ({ ...f, mobileNumber: e.target.value }))
                        : setAdminForm(f => ({ ...f, mobileNumber: e.target.value })))}
                    />
                  </FieldRow>
                  <FieldRow
                    label={t('studentProfile:fields.emergencyContact')}
                    display={profile.emergencyContact || na}
                    editing={adminEditing || (isStudentSelf && selfEditing)}
                  >
                    <input
                      type="text"
                      value={isStudentSelf && selfEditing ? selfForm.emergencyContact : adminForm.emergencyContact}
                      onChange={e => (isStudentSelf && selfEditing
                        ? setSelfForm(f => ({ ...f, emergencyContact: e.target.value }))
                        : setAdminForm(f => ({ ...f, emergencyContact: e.target.value })))}
                    />
                  </FieldRow>
                </div>
                <FieldRow label={t('studentProfile:fields.email')} display={student.email} editing={false} />
                {isStudentSelf && <div className="field-hint no-print">{t('studentProfile:adminEditHint')}</div>}
              </div>

              {/* --- Official / Academic Information --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('studentProfile:sections.academic')}</div></div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.entryTestMarks')} display={profile.entryTestMarks ?? na} editing={adminEditing}>
                    <input type="number" step="0.01" value={adminForm.entryTestMarks} onChange={e => setAdminForm(f => ({ ...f, entryTestMarks: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('studentProfile:fields.sponsor')} display={profile.sponsor || na} editing={adminEditing}>
                    <input type="text" value={adminForm.sponsor} onChange={e => setAdminForm(f => ({ ...f, sponsor: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.classSection')} display={profile.section || na} editing={adminEditing}>
                    <input type="text" value={adminForm.section} onChange={e => setAdminForm(f => ({ ...f, section: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('studentProfile:fields.term')} display={activeTerm?.name || na} editing={false} />
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.batch')} display={profile.batch || na} editing={adminEditing}>
                    <input type="text" placeholder={t('studentProfile:batchPlaceholder')} value={adminForm.batch} onChange={e => setAdminForm(f => ({ ...f, batch: e.target.value }))} />
                  </FieldRow>
                  <div />
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.specialization')} display={profile.specialization || na} editing={adminEditing}>
                    <input type="text" value={adminForm.specialization} onChange={e => setAdminForm(f => ({ ...f, specialization: e.target.value }))} />
                  </FieldRow>
                  <FieldRow
                    label={t('studentProfile:fields.enrollmentStatus')}
                    display={profile.enrollmentStatus ? t(`studentProfile:enrollmentOptions.${profile.enrollmentStatus}`) : na}
                    editing={adminEditing}
                  >
                    <select value={adminForm.enrollmentStatus} onChange={e => setAdminForm(f => ({ ...f, enrollmentStatus: e.target.value }))}>
                      {ENROLLMENT_OPTIONS.map(v => <option key={v} value={v}>{t(`studentProfile:enrollmentOptions.${v}`)}</option>)}
                    </select>
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow
                    label={t('studentProfile:fields.admissionStatus')}
                    display={profile.admissionStatus ? t(`studentProfile:admissionOptions.${profile.admissionStatus}`) : na}
                    editing={adminEditing}
                  >
                    <select value={adminForm.admissionStatus} onChange={e => setAdminForm(f => ({ ...f, admissionStatus: e.target.value }))}>
                      {ADMISSION_OPTIONS.map(v => <option key={v} value={v}>{t(`studentProfile:admissionOptions.${v}`)}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow
                    label={t('studentProfile:fields.studentStatus')}
                    display={profile.studentStatus ? t(`studentProfile:studentStatusOptions.${profile.studentStatus}`) : na}
                    editing={adminEditing}
                  >
                    <select value={adminForm.studentStatus} onChange={e => setAdminForm(f => ({ ...f, studentStatus: e.target.value }))}>
                      {STUDENT_STATUS_OPTIONS.map(v => <option key={v} value={v}>{t(`studentProfile:studentStatusOptions.${v}`)}</option>)}
                    </select>
                  </FieldRow>
                </div>
              </div>

              {/* --- Educational Information --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('studentProfile:sections.educational')}</div></div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.department')} display={department?.name || na} editing={adminEditing}>
                    <select value={adminForm.departmentId} onChange={e => setAdminForm(f => ({ ...f, departmentId: e.target.value }))}>
                      <option value="">{t('studentProfile:select')}</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label={t('studentProfile:fields.program')} display={program?.name || na} editing={adminEditing}>
                    <select value={adminForm.programId} onChange={e => setAdminForm(f => ({ ...f, programId: e.target.value }))}>
                      <option value="">{t('studentProfile:select')}</option>
                      {programs
                        .filter(p => !adminForm.departmentId || String(p.departmentId) === String(adminForm.departmentId))
                        .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.studentType')} display={studentType?.name || na} editing={adminEditing}>
                    <select value={adminForm.studentTypeId} onChange={e => setAdminForm(f => ({ ...f, studentTypeId: e.target.value }))}>
                      <option value="">{t('studentProfile:select')}</option>
                      {studentTypes.filter(s => s.isActive).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </FieldRow>
                  {/* Current semester now lives in the Academic Progression panel above — it's
                      driven by automatic evaluation/manual override, not a free-text edit here. */}
                  <div />
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('studentProfile:fields.previousSchool')} display={profile.previousSchoolName || na} editing={adminEditing}>
                    <input type="text" value={adminForm.previousSchoolName} onChange={e => setAdminForm(f => ({ ...f, previousSchoolName: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('studentProfile:fields.previousGraduationYear')} display={profile.previousGraduationYear ?? na} editing={adminEditing}>
                    <input type="number" value={adminForm.previousGraduationYear} onChange={e => setAdminForm(f => ({ ...f, previousGraduationYear: e.target.value }))} />
                  </FieldRow>
                </div>
                <FieldRow label={t('studentProfile:fields.advisor')} display={advisor?.name || na} editing={adminEditing}>
                  <select value={adminForm.advisorTeacherId} onChange={e => setAdminForm(f => ({ ...f, advisorTeacherId: e.target.value }))}>
                    <option value="">{t('studentProfile:select')}</option>
                    {teachers.map(tch => <option key={tch.id} value={tch.id}>{tch.name}</option>)}
                  </select>
                </FieldRow>

                <div className="stat-grid" style={{ marginTop: 14, marginBottom: 0 }}>
                  <StatCard
                    icon="ti-school" hue="indigo"
                    label={t('studentProfile:fields.gpa')}
                    value={gpa != null ? t('studentProfile:gpaScale', { gpa: gpa.toFixed(2) }) : t('studentProfile:gpaNotAvailable')}
                  />
                  <StatCard
                    icon="ti-certificate" hue="teal"
                    label={t('studentProfile:fields.credits')}
                    value={completedCredits}
                    sub={requiredCredits ? t('studentProfile:creditsProgress', { completed: completedCredits, required: requiredCredits }) : t('studentProfile:creditsNoTarget', { completed: completedCredits })}
                    delta={requiredCredits != null ? { label: `${pct}%`, tone: pct === 100 ? 'positive' : 'neutral' } : undefined}
                  >
                    {requiredCredits != null && (
                      <div className="profile-progress-bar" style={{ marginTop: 8 }}><div className="profile-progress-fill" style={{ width: `${pct}%` }}></div></div>
                    )}
                  </StatCard>
                </div>
              </div>

              {/* --- Official Documents --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('studentProfile:sections.documents')}</div></div>
                {isAdmin && (
                  <div className="profile-doc-upload no-print">
                    <select value={docType} onChange={e => setDocType(e.target.value)}>
                      {DOCUMENT_TYPES.map(v => <option key={v} value={v}>{t(`studentProfile:documents.types.${v}`)}</option>)}
                    </select>
                    <input type="text" placeholder={t('studentProfile:documents.titlePlaceholder')} value={docTitle} onChange={e => setDocTitle(e.target.value)} />
                    <input type="file" ref={docFileRef} accept=".pdf,.png,.jpg,.jpeg" />
                    <button className={'btn-sm' + (uploading ? ' btn-loading' : '')} disabled={uploading} onClick={handleUploadDocument}>
                      {uploading ? <span className="spinner"></span> : <><i className="ti ti-upload"></i> {t('studentProfile:documents.upload')}</>}
                    </button>
                  </div>
                )}
                {documents.length === 0 && <div className="field-hint" style={{ padding: '10px 0' }}>{t('studentProfile:documents.empty')}</div>}
                {documents.length > 0 && (
                  <table className="data-table">
                    <thead><tr>
                      <th>{t('studentProfile:documents.typeHeader')}</th>
                      <th>{t('studentProfile:documents.titleHeader')}</th>
                      <th>{t('studentProfile:documents.uploadedHeader')}</th>
                      <th className="no-print"></th>
                    </tr></thead>
                    <tbody>
                      {documents.map(doc => (
                        <tr key={doc.id}>
                          <td>{t(`studentProfile:documents.types.${doc.documentType}`, doc.documentType)}</td>
                          <td>{doc.title}</td>
                          <td>{(doc.createdAt || '').split(' ')[0]}</td>
                          <td className="no-print"><div className="row-actions">
                            <button className="btn-sm" onClick={() => downloadStudentDocument(doc.id, doc.fileName)}>
                              <i className="ti ti-download"></i> {t('studentProfile:documents.download')}
                            </button>
                            {isAdmin && (
                              <button className="icon-btn danger" aria-label={t('studentProfile:documents.delete')} onClick={() => handleDeleteDocument(doc)}>
                                <i className="ti ti-trash" aria-hidden="true"></i>
                              </button>
                            )}
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          );
        })()}
      </div>
    </Section>
  );
}
