import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { can } from '../permissions.js';
import { fetchTeacherProfile, saveTeacherProfile } from '../api.js';
import { fmtDate, departmentName, teacherById, isForbidden } from '../utils.js';
import TeacherPhotoUpload from '../components/teacher/TeacherPhotoUpload.jsx';
import TeacherEducationSection from '../components/teacher/TeacherEducationSection.jsx';
import TeacherCertificationsSection from '../components/teacher/TeacherCertificationsSection.jsx';
import TeacherExperienceSection from '../components/teacher/TeacherExperienceSection.jsx';
import TeacherDocumentsSection from '../components/teacher/TeacherDocumentsSection.jsx';
import {
  PROFILE_FIELDS, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, DESIGNATIONS, EMPLOYMENT_TYPES, STATUSES, formStateFromProfile, FieldRow,
} from '../components/teacher/teacherProfileShared.jsx';

const STATUS_PILL = {
  Active: 'pill-green', 'On Leave': 'pill-amber', Suspended: 'pill-red', Inactive: 'pill-gray',
  Resigned: 'pill-red', Retired: 'pill-gray', Terminated: 'pill-red',
};
const PROFILE_STATUS_PILL = {
  Complete: 'pill-green', 'Under Review': 'pill-blue', Incomplete: 'pill-amber', 'Documents Pending': 'pill-amber',
};
// Every teacher-scoped audit entity — used to filter the app-wide audit log down to this
// teacher's own history (no backend change needed; auditLog is already loaded in full).
const AUDIT_ENTITIES = ['teachers', 'teacher_profiles', 'teacher_education', 'teacher_experience', 'teacher_certifications', 'teacher_documents'];

export default function TeacherProfilePage() {
  const { t } = useTranslation(['teacherProfile', 'common']);
  const { currentUser, departments, colleges, teachers, auditLog } = useAppData();
  const { sectionFocus } = useNavigation();
  const { toast } = useToast();
  const { run: runSave, loading: saving } = useAsyncAction();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  const na = t('common:notApplicable');
  const canWrite = can(currentUser.role, 'teachers', 'write');
  const canSeePayroll = can(currentUser.role, 'finance', 'write');
  const viewingTeacherId = sectionFocus?.section === 'teacher-profile' && sectionFocus.teacherId != null
    ? Number(sectionFocus.teacherId)
    : null;

  // Every page in this app stays mounted at all times (see AppShell.jsx) — only fetch when a
  // teacher has actually been selected (from the Teachers page's "Full Profile" action).
  useEffect(() => {
    if (!viewingTeacherId) { setData(null); setForbidden(false); return; }
    setLoading(true);
    setForbidden(false);
    setEditing(false);
    fetchTeacherProfile(viewingTeacherId)
      .then(d => { setData(d); setForm(formStateFromProfile(d.profile)); })
      .catch(err => {
        // See StudentDetailPage.jsx for why a 403 gets its own state instead of a toast.
        if (isForbidden(err)) { setForbidden(true); return; }
        toast(err.message, 'error');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingTeacherId]);

  async function refresh() {
    const fresh = await fetchTeacherProfile(viewingTeacherId);
    setData(fresh);
    setForm(formStateFromProfile(fresh.profile));
  }

  async function handleSave() {
    const payload = {};
    for (const f of PROFILE_FIELDS) {
      if (f === 'payrollId' && !canSeePayroll) continue;
      if (f === 'reportingManagerId') { payload[f] = form[f] ? Number(form[f]) : null; continue; }
      payload[f] = form[f] === '' ? null : form[f];
    }
    try {
      await runSave(saveTeacherProfile(viewingTeacherId, payload));
      await refresh();
      setEditing(false);
      toast(t('teacherProfile:toasts.saved'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!viewingTeacherId) {
    return (
      <Section name="teacher-profile">
        <div className="topbar">
          <i className="ti ti-id-badge-2" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
          <h2>{t('teacherProfile:title')}</h2>
        </div>
        <div id="content">
          <div className="field-hint" style={{ padding: 14 }}>{t('teacherProfile:noTeacherSelected')}</div>
        </div>
      </Section>
    );
  }

  return (
    <Section name="teacher-profile">
      <div className="topbar">
        <i className="ti ti-id-badge-2" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('teacherProfile:title')}</h2>
        <div className="topbar-actions no-print">
          <button className="btn-sm" onClick={() => window.print()}><i className="ti ti-printer"></i> {t('teacherProfile:print')}</button>
        </div>
      </div>
      <div id="content">
        {loading && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
        {!loading && forbidden && <div className="field-hint" style={{ padding: 14 }}>{t('common:accessDenied')}</div>}
        {!loading && !forbidden && !data && <div className="field-hint" style={{ padding: 14 }}>{t('teacherProfile:notFound')}</div>}
        {!loading && data && (() => {
          const { teacher, profile, education, experience, certifications, documents, completion } = data;
          const department = departments.find(d => d.id === teacher.departmentId);
          const college = department?.collegeId != null ? colleges.find(c => c.id === department.collegeId) : null;
          const reportingManager = profile.reportingManagerId != null ? teacherById(teachers, profile.reportingManagerId) : null;
          const teacherAuditEntries = auditLog.filter(e => {
            if (!AUDIT_ENTITIES.includes(e.entityType)) return false;
            // teachers/teacher_profiles are keyed by teacherId directly; the related child
            // tables (education/experience/certifications/documents) are keyed by their own
            // row id, so the teacherId they belong to has to be read out of the audit details
            // JSON that every teacherProfile.js logAudit() call already includes.
            if (e.entityType === 'teachers' || e.entityType === 'teacher_profiles') return Number(e.entityId) === teacher.id;
            try {
              return Number(JSON.parse(e.details || '{}').teacherId) === teacher.id;
            } catch {
              return false;
            }
          });

          return (
            <>
              <div className="panel profile-header-panel">
                <TeacherPhotoUpload teacherId={teacher.id} name={teacher.name} photoPath={profile.photoPath} canWrite={canWrite && !editing} onUploaded={refresh} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="profile-header-name">{teacher.name}</div>
                  <div className="profile-header-meta">
                    {profile.employeeId && <span className="pill pill-gray"><code>{profile.employeeId}</code></span>}
                    {profile.designation && <span className="pill pill-blue">{t(`teacherProfile:designationOptions.${profile.designation}`, profile.designation)}</span>}
                    {profile.status && <span className={'pill ' + (STATUS_PILL[profile.status] || 'pill-gray')}>{t(`teacherProfile:statusOptions.${profile.status}`, profile.status)}</span>}
                    <span className={'pill ' + (PROFILE_STATUS_PILL[completion.profileStatus] || 'pill-gray')}>{t(`teacherProfile:profileStatus.${completion.profileStatus}`, completion.profileStatus)}</span>
                  </div>
                  <div className="field-hint" style={{ margin: '4px 0 0' }}>
                    {departmentName(departments, teacher.departmentId)}{college ? ` · ${college.name}` : ''}
                  </div>
                  <div className="profile-progress-bar" title={t('teacherProfile:completion.percent', { percent: completion.percent })}>
                    <div className="profile-progress-fill" style={{ width: `${completion.percent}%` }}></div>
                  </div>
                  {completion.missing.length > 0 && (
                    <div className="field-hint" style={{ marginTop: 4 }}>
                      {t('teacherProfile:completion.missingLabel')}{' '}
                      {completion.missing.map((m, i) => (
                        <span key={i}>
                          {i > 0 && ', '}
                          {m.field ? t(`teacherProfile:fields.${m.field}`, m.field) : t(`teacherProfile:completion.section.${m.section}`)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {canWrite && !editing && (
                  <div className="no-print" style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-sm" onClick={() => setEditing(true)}><i className="ti ti-pencil"></i> {t('teacherProfile:editProfile')}</button>
                  </div>
                )}
                {canWrite && editing && (
                  <div className="no-print" style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-sm" onClick={() => { setEditing(false); setForm(formStateFromProfile(profile)); }}>{t('common:actions.cancel')}</button>
                    <button className={'btn-primary' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handleSave}>
                      {saving ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
                    </button>
                  </div>
                )}
              </div>

              {/* --- Personal Details --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.personal')}</div></div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.fullName')} display={teacher.name} editing={false} />
                  <FieldRow label={t('teacherProfile:fields.preferredName')} display={profile.preferredName || na} editing={editing}>
                    <input type="text" value={form.preferredName} onChange={e => setForm(f => ({ ...f, preferredName: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.gender')} display={profile.gender ? t(`teacherProfile:genderOptions.${profile.gender}`) : na} editing={editing}>
                    <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                      <option value="">{t('teacherProfile:select')}</option>
                      {GENDER_OPTIONS.map(g => <option key={g} value={g}>{t(`teacherProfile:genderOptions.${g}`)}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.dateOfBirth')} display={profile.dateOfBirth ? fmtDate(profile.dateOfBirth) : na} editing={editing}>
                    <input type="date" value={form.dateOfBirth} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.fatherName')} display={profile.fatherName || na} editing={editing}>
                    <input type="text" value={form.fatherName} onChange={e => setForm(f => ({ ...f, fatherName: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.motherName')} display={profile.motherName || na} editing={editing}>
                    <input type="text" value={form.motherName} onChange={e => setForm(f => ({ ...f, motherName: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.nationality')} display={profile.nationality || na} editing={editing}>
                    <input type="text" value={form.nationality} onChange={e => setForm(f => ({ ...f, nationality: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.nationalId')} display={profile.nationalId || na} editing={editing}>
                    <input type="text" value={form.nationalId} onChange={e => setForm(f => ({ ...f, nationalId: e.target.value }))} />
                  </FieldRow>
                </div>
                <FieldRow label={t('teacherProfile:fields.maritalStatus')} display={profile.maritalStatus ? t(`teacherProfile:maritalStatusOptions.${profile.maritalStatus}`) : na} editing={editing}>
                  <select value={form.maritalStatus} onChange={e => setForm(f => ({ ...f, maritalStatus: e.target.value }))}>
                    <option value="">{t('teacherProfile:select')}</option>
                    {MARITAL_STATUS_OPTIONS.map(m => <option key={m} value={m}>{t(`teacherProfile:maritalStatusOptions.${m}`)}</option>)}
                  </select>
                </FieldRow>
              </div>

              {/* --- Contact --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.contact')}</div></div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.officialEmail')} display={profile.officialEmail || na} editing={editing}>
                    <input type="email" value={form.officialEmail} onChange={e => setForm(f => ({ ...f, officialEmail: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.personalEmail')} display={profile.personalEmail || na} editing={editing}>
                    <input type="email" value={form.personalEmail} onChange={e => setForm(f => ({ ...f, personalEmail: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.phone')} display={profile.phone || na} editing={editing}>
                    <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.secondaryPhone')} display={profile.secondaryPhone || na} editing={editing}>
                    <input type="text" value={form.secondaryPhone} onChange={e => setForm(f => ({ ...f, secondaryPhone: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.emergencyContactName')} display={profile.emergencyContactName || na} editing={editing}>
                    <input type="text" value={form.emergencyContactName} onChange={e => setForm(f => ({ ...f, emergencyContactName: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.emergencyContactRelationship')} display={profile.emergencyContactRelationship || na} editing={editing}>
                    <input type="text" value={form.emergencyContactRelationship} onChange={e => setForm(f => ({ ...f, emergencyContactRelationship: e.target.value }))} />
                  </FieldRow>
                </div>
                <FieldRow label={t('teacherProfile:fields.emergencyContactPhone')} display={profile.emergencyContactPhone || na} editing={editing}>
                  <input type="text" value={form.emergencyContactPhone} onChange={e => setForm(f => ({ ...f, emergencyContactPhone: e.target.value }))} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.address')} display={profile.address || na} editing={editing}>
                  <textarea rows={2} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.permanentAddress')} display={profile.permanentAddress || na} editing={editing}>
                  <textarea rows={2} value={form.permanentAddress} onChange={e => setForm(f => ({ ...f, permanentAddress: e.target.value }))} />
                </FieldRow>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.city')} display={profile.city || na} editing={editing}>
                    <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.province')} display={profile.province || na} editing={editing}>
                    <input type="text" value={form.province} onChange={e => setForm(f => ({ ...f, province: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.country')} display={profile.country || na} editing={editing}>
                    <input type="text" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.postalCode')} display={profile.postalCode || na} editing={editing}>
                    <input type="text" value={form.postalCode} onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))} />
                  </FieldRow>
                </div>
              </div>

              {/* --- Employment --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.employment')}</div></div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.department')} display={departmentName(departments, teacher.departmentId)} editing={false} />
                  <FieldRow label={t('teacherProfile:fields.college')} display={college?.name || na} editing={false} />
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.designation')} display={profile.designation ? t(`teacherProfile:designationOptions.${profile.designation}`) : na} editing={editing}>
                    <select value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}>
                      <option value="">{t('teacherProfile:select')}</option>
                      {DESIGNATIONS.map(d => <option key={d} value={d}>{t(`teacherProfile:designationOptions.${d}`)}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.employmentType')} display={profile.employmentType ? t(`teacherProfile:employmentTypeOptions.${profile.employmentType}`) : na} editing={editing}>
                    <select value={form.employmentType} onChange={e => setForm(f => ({ ...f, employmentType: e.target.value }))}>
                      <option value="">{t('teacherProfile:select')}</option>
                      {EMPLOYMENT_TYPES.map(v => <option key={v} value={v}>{t(`teacherProfile:employmentTypeOptions.${v}`)}</option>)}
                    </select>
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.status')} display={profile.status ? t(`teacherProfile:statusOptions.${profile.status}`) : na} editing={editing}>
                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(v => <option key={v} value={v}>{t(`teacherProfile:statusOptions.${v}`)}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.dateOfJoining')} display={profile.dateOfJoining ? fmtDate(profile.dateOfJoining) : na} editing={editing}>
                    <input type="date" value={form.dateOfJoining} onChange={e => setForm(f => ({ ...f, dateOfJoining: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.contractStartDate')} display={profile.contractStartDate ? fmtDate(profile.contractStartDate) : na} editing={editing}>
                    <input type="date" value={form.contractStartDate} onChange={e => setForm(f => ({ ...f, contractStartDate: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.contractEndDate')} display={profile.contractEndDate ? fmtDate(profile.contractEndDate) : na} editing={editing}>
                    <input type="date" value={form.contractEndDate} onChange={e => setForm(f => ({ ...f, contractEndDate: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.officeRoom')} display={profile.officeRoom || na} editing={editing}>
                    <input type="text" value={form.officeRoom} onChange={e => setForm(f => ({ ...f, officeRoom: e.target.value }))} />
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.workLocation')} display={profile.workLocation || na} editing={editing}>
                    <input type="text" value={form.workLocation} onChange={e => setForm(f => ({ ...f, workLocation: e.target.value }))} />
                  </FieldRow>
                </div>
                <div className="form-row-2">
                  <FieldRow label={t('teacherProfile:fields.reportingManager')} display={reportingManager?.name || na} editing={editing}>
                    <select value={form.reportingManagerId} onChange={e => setForm(f => ({ ...f, reportingManagerId: e.target.value }))}>
                      <option value="">{t('teacherProfile:select')}</option>
                      {teachers.filter(tc => tc.id !== teacher.id).map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label={t('teacherProfile:fields.employeeCategory')} display={profile.employeeCategory || na} editing={editing}>
                    <input type="text" value={form.employeeCategory} onChange={e => setForm(f => ({ ...f, employeeCategory: e.target.value }))} />
                  </FieldRow>
                </div>
                {canSeePayroll && (
                  <FieldRow label={t('teacherProfile:fields.payrollId')} display={profile.payrollId || na} editing={editing}>
                    <input type="text" value={form.payrollId} onChange={e => setForm(f => ({ ...f, payrollId: e.target.value }))} />
                  </FieldRow>
                )}
                <FieldRow label={t('teacherProfile:fields.qualifiedSubjects')} display={profile.qualifiedSubjects || na} editing={editing}>
                  <input type="text" placeholder={t('teacherProfile:fields.qualifiedSubjectsPlaceholder')} value={form.qualifiedSubjects} onChange={e => setForm(f => ({ ...f, qualifiedSubjects: e.target.value }))} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.bio')} display={profile.bio || na} editing={editing}>
                  <textarea rows={3} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
                </FieldRow>
              </div>

              {/* --- Academic Profile --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.academic')}</div></div>
                <FieldRow label={t('teacherProfile:fields.expertiseAreas')} display={profile.expertiseAreas || na} editing={editing}>
                  <textarea rows={2} value={form.expertiseAreas} onChange={e => setForm(f => ({ ...f, expertiseAreas: e.target.value }))} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.researchInterests')} display={profile.researchInterests || na} editing={editing}>
                  <textarea rows={2} value={form.researchInterests} onChange={e => setForm(f => ({ ...f, researchInterests: e.target.value }))} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.teachingInterests')} display={profile.teachingInterests || na} editing={editing}>
                  <textarea rows={2} value={form.teachingInterests} onChange={e => setForm(f => ({ ...f, teachingInterests: e.target.value }))} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.officeHours')} display={profile.officeHours || na} editing={editing}>
                  <input type="text" placeholder={t('teacherProfile:fields.officeHoursPlaceholder')} value={form.officeHours} onChange={e => setForm(f => ({ ...f, officeHours: e.target.value }))} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.publications')} display={profile.publications || na} editing={editing}>
                  <textarea rows={3} value={form.publications} onChange={e => setForm(f => ({ ...f, publications: e.target.value }))} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.awards')} display={profile.awards || na} editing={editing}>
                  <textarea rows={2} value={form.awards} onChange={e => setForm(f => ({ ...f, awards: e.target.value }))} />
                </FieldRow>
              </div>

              <TeacherEducationSection teacherId={teacher.id} education={education} canWrite={canWrite} onChanged={refresh} />
              <TeacherCertificationsSection teacherId={teacher.id} certifications={certifications} canWrite={canWrite} onChanged={refresh} />
              <TeacherExperienceSection teacherId={teacher.id} experience={experience} canWrite={canWrite} onChanged={refresh} />
              <TeacherDocumentsSection teacherId={teacher.id} documents={documents} canWrite={canWrite} onChanged={refresh} />

              {/* --- Audit History --- */}
              <div className="panel no-print">
                <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.auditHistory')}</div></div>
                {teacherAuditEntries.length === 0 && <div className="field-hint" style={{ padding: '10px 0' }}>{t('teacherProfile:auditHistory.empty')}</div>}
                {teacherAuditEntries.length > 0 && (
                  <table className="data-table">
                    <thead><tr>
                      <th>{t('teacherProfile:auditHistory.timeHeader')}</th>
                      <th>{t('teacherProfile:auditHistory.userHeader')}</th>
                      <th>{t('teacherProfile:auditHistory.actionHeader')}</th>
                      <th>{t('teacherProfile:auditHistory.entityHeader')}</th>
                    </tr></thead>
                    <tbody>
                      {teacherAuditEntries.map((e, i) => (
                        <tr key={e.id ?? i}>
                          <td>{new Date(e.createdAt + 'Z').toLocaleString()}</td>
                          <td>{e.userName || t('teacherProfile:auditHistory.unknownUser')}</td>
                          <td>{e.action}</td>
                          <td>{e.entityType}</td>
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
