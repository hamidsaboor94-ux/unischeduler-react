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
} from '../api.js';
import { initials, fmtDate } from '../utils.js';

const NUMERIC_FIELDS = new Set(['entryTestMarks', 'advisorTeacherId', 'departmentId', 'programSemester', 'previousGraduationYear']);
// Every student_profiles column an admin may edit — mirrors ADMIN_FIELDS in api/src/routes/studentProfile.js.
const ADMIN_FIELDS = [
  'fatherName', 'grandfatherName', 'gender', 'dateOfBirth', 'nationality', 'nationalId', 'passportNumber',
  'presentAddress', 'permanentAddress', 'mobileNumber', 'emergencyContact',
  'entryTestMarks', 'sponsor', 'specialization', 'advisorTeacherId', 'departmentId',
  'programSemester', 'section', 'admissionStatus', 'enrollmentStatus',
  'previousSchoolName', 'previousGraduationYear',
];
const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const ADMISSION_OPTIONS = ['Approved', 'Pending', 'Rejected'];
const ENROLLMENT_OPTIONS = ['Regular', 'Part-time', 'Probation', 'Withdrawn'];
const DOCUMENT_TYPES = ['ID Scan', 'Certificate', 'Transcript', 'Passport Copy', 'Other'];
const ADMISSION_PILL = { Approved: 'pill-green', Pending: 'pill-amber', Rejected: 'pill-red' };
const ENROLLMENT_PILL = { Regular: 'pill-green', 'Part-time': 'pill-blue', Probation: 'pill-amber', Withdrawn: 'pill-red' };

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
  const { currentUser, departments, teachers } = useAppData();
  const { sectionFocus } = useNavigation();
  const { confirmAction } = useModal();
  const { toast } = useToast();
  const { run: runSaveAdmin, loading: savingAdmin } = useAsyncAction();
  const { run: runSaveSelf, loading: savingSelf } = useAsyncAction();
  const { run: runUpload, loading: uploading } = useAsyncAction();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [adminEditing, setAdminEditing] = useState(false);
  const [selfEditing, setSelfEditing] = useState(false);
  const [adminForm, setAdminForm] = useState({});
  const [selfForm, setSelfForm] = useState({ mobileNumber: '', emergencyContact: '' });
  const [docType, setDocType] = useState(DOCUMENT_TYPES[0]);
  const [docTitle, setDocTitle] = useState('');
  const docFileRef = useRef(null);

  const na = t('common:notApplicable');
  const isAdmin = currentUser.role === 'admin';
  const isStudentSelf = currentUser.role === 'student';
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
    if (!viewingStudentId || (!isAdmin && !isStudentSelf)) { setData(null); return; }
    setLoading(true);
    setAdminEditing(false);
    setSelfEditing(false);
    fetchStudentProfile(viewingStudentId)
      .then(d => {
        setData(d);
        setAdminForm(formStateFromProfile(d.profile));
        setSelfForm({ mobileNumber: d.profile.mobileNumber || '', emergencyContact: d.profile.emergencyContact || '' });
      })
      .catch(err => toast(err.message, 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingStudentId]);

  async function refresh() {
    const fresh = await fetchStudentProfile(viewingStudentId);
    setData(fresh);
    setAdminForm(formStateFromProfile(fresh.profile));
    setSelfForm({ mobileNumber: fresh.profile.mobileNumber || '', emergencyContact: fresh.profile.emergencyContact || '' });
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
        {!loading && !data && <div className="field-hint" style={{ padding: 14 }}>{t('studentProfile:notFound')}</div>}
        {!loading && data && (() => {
          const { student, profile, department, advisor, activeTerm, gpa, completedCredits, requiredCredits, documents } = data;
          const pct = requiredCredits ? Math.min(100, Math.round((completedCredits / requiredCredits) * 100)) : 0;
          return (
            <>
              <div className="panel profile-header-panel">
                <div className="avatar-lg">{initials(student.name || student.email)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="profile-header-name">{student.name || na}</div>
                  <div className="profile-header-meta">
                    {student.idNumber && <span className="pill pill-gray">{student.idNumber}</span>}
                    {profile.admissionStatus && <span className={'pill ' + (ADMISSION_PILL[profile.admissionStatus] || 'pill-gray')}>{t(`studentProfile:admissionOptions.${profile.admissionStatus}`)}</span>}
                    {profile.enrollmentStatus && <span className={'pill ' + (ENROLLMENT_PILL[profile.enrollmentStatus] || 'pill-gray')}>{t(`studentProfile:enrollmentOptions.${profile.enrollmentStatus}`)}</span>}
                  </div>
                  <div className="field-hint" style={{ margin: '4px 0 0' }}>{t('studentProfile:memberSince', { date: (student.createdAt || '').split(' ')[0] || na })}</div>
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
                <FieldRow
                  label={t('studentProfile:fields.admissionStatus')}
                  display={profile.admissionStatus ? t(`studentProfile:admissionOptions.${profile.admissionStatus}`) : na}
                  editing={adminEditing}
                >
                  <select value={adminForm.admissionStatus} onChange={e => setAdminForm(f => ({ ...f, admissionStatus: e.target.value }))}>
                    {ADMISSION_OPTIONS.map(v => <option key={v} value={v}>{t(`studentProfile:admissionOptions.${v}`)}</option>)}
                  </select>
                </FieldRow>
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
                  <FieldRow label={t('studentProfile:fields.programSemester')} display={profile.programSemester ?? na} editing={adminEditing}>
                    <input type="number" min="1" value={adminForm.programSemester} onChange={e => setAdminForm(f => ({ ...f, programSemester: e.target.value }))} />
                  </FieldRow>
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
                  <div className="stat-card stat-accent-blue">
                    <div className="s-icon s-blue"><i className="ti ti-school"></i></div>
                    <div className="stat-label">{t('studentProfile:fields.gpa')}</div>
                    <div className="stat-value">{gpa != null ? t('studentProfile:gpaScale', { gpa: gpa.toFixed(2) }) : t('studentProfile:gpaNotAvailable')}</div>
                  </div>
                  <div className="stat-card stat-accent-green">
                    <div className="s-icon s-green"><i className="ti ti-certificate"></i></div>
                    <div className="stat-label">{t('studentProfile:fields.credits')}</div>
                    <div className="stat-value">{completedCredits}</div>
                    <div className="stat-sub">{requiredCredits ? t('studentProfile:creditsProgress', { completed: completedCredits, required: requiredCredits }) : t('studentProfile:creditsNoTarget', { completed: completedCredits })}</div>
                    {requiredCredits != null && (
                      <div className="profile-progress-bar"><div className="profile-progress-fill" style={{ width: `${pct}%` }}></div></div>
                    )}
                  </div>
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
