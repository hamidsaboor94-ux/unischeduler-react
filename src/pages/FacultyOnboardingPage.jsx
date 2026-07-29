import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { can } from '../permissions.js';
import { api, saveTeacher, fetchTeacherProfile, saveTeacherProfile } from '../api.js';
import { roleLabel } from '../roleNames.js';
import {
  FieldRow, formStateFromProfile, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, DESIGNATIONS, EMPLOYMENT_TYPES, STATUSES,
} from '../components/teacher/teacherProfileShared.jsx';
import TeacherPhotoUpload from '../components/teacher/TeacherPhotoUpload.jsx';
import TeacherEducationSection from '../components/teacher/TeacherEducationSection.jsx';
import TeacherCertificationsSection from '../components/teacher/TeacherCertificationsSection.jsx';
import TeacherDocumentsSection from '../components/teacher/TeacherDocumentsSection.jsx';
import TeacherCourseAssignmentsSection from '../components/teacher/TeacherCourseAssignmentsSection.jsx';

// The bare teachers/teacher_profiles rows created after Step 1's first "Next" ARE the draft —
// no parallel draft store. This just remembers which row to offer resuming across a full app
// reload (within one running session the always-mounted page's own state already does that).
const DRAFT_KEY = 'facultyOnboardingDraftTeacherId';
const STEP_KEYS = ['personal', 'employment', 'education', 'teaching', 'documents', 'account'];

export default function FacultyOnboardingPage() {
  const { t } = useTranslation(['facultyOnboarding', 'teacherProfile', 'common']);
  const { currentUser, departments, colleges, teachers, branding, reload } = useAppData();
  const { showSection } = useNavigation();
  const { openModal, confirmAction } = useModal();
  const { toast } = useToast();
  const { run: runStep, loading: savingStep } = useAsyncAction();
  const { run: runFinish, loading: finishing } = useAsyncAction();

  const canWrite = can(currentUser.role, 'teachers', 'write');
  const canSeePayroll = can(currentUser.role, 'finance', 'write');

  const [step, setStep] = useState(0);
  const [teacherId, setTeacherId] = useState(null);
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [form, setForm] = useState(() => formStateFromProfile(null));
  const [data, setData] = useState(null);
  const [createLogin, setCreateLogin] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);

  const draftTeacherId = localStorage.getItem(DRAFT_KEY);
  const showDraftBanner = step === 0 && !teacherId && draftTeacherId && !draftBannerDismissed;
  const department = departmentId ? departments.find(d => d.id === Number(departmentId)) : null;
  const college = department?.collegeId != null ? colleges.find(c => c.id === department.collegeId) : null;

  function setField(key, value) { setForm(f => ({ ...f, [key]: value })); }

  // Prefill the login email from Step 1's Email once, the first time Step 6 is reached — a plain
  // `loginEmail || form.officialEmail` fallback in the input would make the field un-clearable.
  useEffect(() => {
    if (step === 5 && !loginEmail && form.officialEmail) setLoginEmail(form.officialEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function resumeDraft() {
    const id = Number(draftTeacherId);
    try {
      const fresh = await fetchTeacherProfile(id);
      setTeacherId(id);
      setData(fresh);
      setName(fresh.teacher.name);
      setDepartmentId(fresh.teacher.departmentId != null ? String(fresh.teacher.departmentId) : '');
      setForm(formStateFromProfile(fresh.profile));
      setDraftBannerDismissed(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setDraftBannerDismissed(true);
  }

  function resetWizard() {
    setStep(0); setTeacherId(null); setName(''); setDepartmentId('');
    setForm(formStateFromProfile(null)); setData(null); setCreateLogin(true); setLoginEmail('');
    setDraftBannerDismissed(false);
  }

  async function handleNext() {
    try {
      if (step === 0) {
        const trimmedName = name.trim();
        if (!trimmedName) { toast(t('facultyOnboarding:validation.nameRequired'), 'warning'); return; }
        await runStep((async () => {
          let id = teacherId;
          if (!id) {
            const created = await saveTeacher({ name: trimmedName, departmentId: null });
            id = created.id;
            setTeacherId(id);
            localStorage.setItem(DRAFT_KEY, String(id));
          } else if (trimmedName !== name) {
            await saveTeacher({ name: trimmedName }, id);
          }
          await saveTeacherProfile(id, {
            fatherName: form.fatherName || null, gender: form.gender || null, dateOfBirth: form.dateOfBirth || null,
            nationality: form.nationality || null, nationalId: form.nationalId || null, maritalStatus: form.maritalStatus || null,
            officialEmail: form.officialEmail || null, phone: form.phone || null, address: form.address || null,
            emergencyContactName: form.emergencyContactName || null, emergencyContactRelationship: form.emergencyContactRelationship || null,
            emergencyContactPhone: form.emergencyContactPhone || null,
          });
          setData(await fetchTeacherProfile(id));
        })());
        setName(trimmedName);
        setStep(1);
        return;
      }
      if (step === 1) {
        if (!departmentId) { toast(t('facultyOnboarding:validation.departmentRequired'), 'warning'); return; }
        await runStep((async () => {
          await saveTeacher({ departmentId: Number(departmentId) }, teacherId);
          const employmentPayload = {
            designation: form.designation || null, employmentType: form.employmentType || null, dateOfJoining: form.dateOfJoining || null,
            officeRoom: form.officeRoom || null, status: form.status || null,
            reportingManagerId: form.reportingManagerId ? Number(form.reportingManagerId) : null,
          };
          if (canSeePayroll) employmentPayload.payrollId = form.payrollId || null;
          await saveTeacherProfile(teacherId, employmentPayload);
          setData(await fetchTeacherProfile(teacherId));
        })());
        setStep(2);
        return;
      }
      if (step === 3) {
        await runStep((async () => {
          await saveTeacherProfile(teacherId, {
            expertiseAreas: form.expertiseAreas || null, researchInterests: form.researchInterests || null, officeHours: form.officeHours || null,
          });
          setData(await fetchTeacherProfile(teacherId));
        })());
        setStep(4);
        return;
      }
      setStep(s => Math.min(s + 1, STEP_KEYS.length - 1));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handlePrevious() {
    setStep(s => Math.max(s - 1, 0));
  }

  function handleCancel() {
    confirmAction(
      teacherId ? t('facultyOnboarding:cancelConfirmDraft') : t('facultyOnboarding:cancelConfirmEmpty'),
      () => showSection('teachers'),
    );
  }

  function handleStartNew() {
    confirmAction(t('facultyOnboarding:startNewConfirm'), () => {
      localStorage.removeItem(DRAFT_KEY);
      resetWizard();
    });
  }

  async function handleFinish() {
    try {
      if (createLogin) {
        const email = loginEmail.trim();
        if (!email) { toast(t('facultyOnboarding:validation.emailRequired'), 'warning'); return; }
        const result = await runFinish(api('POST', '/users', { name: name.trim(), email, role: 'faculty', departmentId: Number(departmentId) }));
        openModal('account-credentials', null, {
          accounts: [{ name: name.trim(), email: result.user.email, role: 'faculty', idNumber: result.user.idNumber, tempPassword: result.tempPassword }],
          errors: [],
        });
      }
      localStorage.removeItem(DRAFT_KEY);
      await reload();
      toast(t('facultyOnboarding:toasts.completed'));
      const finishedId = teacherId;
      resetWizard();
      showSection('teacher-profile', { teacherId: finishedId });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!canWrite) {
    return (
      <Section name="faculty-onboarding">
        <div className="topbar">
          <i className="ti ti-user-plus" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
          <h2>{t('facultyOnboarding:title')}</h2>
        </div>
        <div id="content">
          <div className="field-hint" style={{ padding: 14 }}>{t('facultyOnboarding:noPermission')}</div>
        </div>
      </Section>
    );
  }

  const busy = savingStep || finishing;
  const employeeId = data?.profile?.employeeId;

  return (
    <Section name="faculty-onboarding">
      <div className="topbar">
        <i className="ti ti-user-plus" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('facultyOnboarding:title')}</h2>
        <div className="topbar-actions">
          {teacherId != null && (
            <button className="btn-sm" onClick={handleStartNew}>{t('facultyOnboarding:startNew')}</button>
          )}
          <button className="btn-sm" onClick={handleCancel}>{t('common:actions.cancel')}</button>
        </div>
      </div>
      <div id="content">
        <div className="panel" style={{ paddingBottom: 24 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {STEP_KEYS.map((key, i) => (
              <button
                key={key}
                className={'pill ' + (i === step ? 'pill-blue' : i < step ? 'pill-green' : 'pill-gray')}
                disabled={i > step}
                style={{ border: 'none', font: 'inherit', cursor: i <= step ? 'pointer' : 'default' }}
                onClick={() => i <= step && setStep(i)}
              >
                {i + 1}. {t(`facultyOnboarding:steps.${key}`)}
              </button>
            ))}
          </div>

          {showDraftBanner && (
            <div className="panel" style={{ background: 'var(--bg-subtle, transparent)', border: '1px solid var(--border)', marginBottom: 14, padding: 12 }}>
              <div style={{ marginBottom: 8 }}>{t('facultyOnboarding:draftBanner.message')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary" onClick={resumeDraft}>{t('facultyOnboarding:draftBanner.resume')}</button>
                <button className="btn-sm" onClick={discardDraft}>{t('facultyOnboarding:draftBanner.discard')}</button>
              </div>
            </div>
          )}

          {/* --- Step 1: Personal --- */}
          {step === 0 && (
            <>
              <FieldRow label={t('teacherProfile:fields.fullName')} editing>
                <input type="text" placeholder={t('common:fields.fullName')} value={name} onChange={e => setName(e.target.value)} />
              </FieldRow>
              <div className="form-row-2">
                <FieldRow label={t('teacherProfile:fields.fatherName')} editing>
                  <input type="text" value={form.fatherName} onChange={e => setField('fatherName', e.target.value)} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.gender')} editing>
                  <select value={form.gender} onChange={e => setField('gender', e.target.value)}>
                    <option value="">{t('teacherProfile:select')}</option>
                    {GENDER_OPTIONS.map(g => <option key={g} value={g}>{t(`teacherProfile:genderOptions.${g}`)}</option>)}
                  </select>
                </FieldRow>
              </div>
              <div className="form-row-2">
                <FieldRow label={t('teacherProfile:fields.dateOfBirth')} editing>
                  <input type="date" value={form.dateOfBirth} onChange={e => setField('dateOfBirth', e.target.value)} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.nationality')} editing>
                  <input type="text" value={form.nationality} onChange={e => setField('nationality', e.target.value)} />
                </FieldRow>
              </div>
              <div className="form-row-2">
                <FieldRow label={t('teacherProfile:fields.nationalId')} editing>
                  <input type="text" value={form.nationalId} onChange={e => setField('nationalId', e.target.value)} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.maritalStatus')} editing>
                  <select value={form.maritalStatus} onChange={e => setField('maritalStatus', e.target.value)}>
                    <option value="">{t('teacherProfile:select')}</option>
                    {MARITAL_STATUS_OPTIONS.map(m => <option key={m} value={m}>{t(`teacherProfile:maritalStatusOptions.${m}`)}</option>)}
                  </select>
                </FieldRow>
              </div>
              <div className="form-row-2">
                <FieldRow label={t('teacherProfile:fields.email')} editing>
                  <input type="email" value={form.officialEmail} onChange={e => setField('officialEmail', e.target.value)} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.phone')} editing>
                  <input type="text" value={form.phone} onChange={e => setField('phone', e.target.value)} />
                </FieldRow>
              </div>
              <FieldRow label={t('teacherProfile:fields.address')} editing>
                <textarea rows={2} value={form.address} onChange={e => setField('address', e.target.value)} />
              </FieldRow>
              <div className="panel-header" style={{ marginTop: 10 }}><div className="panel-title">{t('facultyOnboarding:emergencyContact')}</div></div>
              <div className="form-row-2">
                <FieldRow label={t('teacherProfile:fields.emergencyContactName')} editing>
                  <input type="text" value={form.emergencyContactName} onChange={e => setField('emergencyContactName', e.target.value)} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.emergencyContactRelationship')} editing>
                  <input type="text" value={form.emergencyContactRelationship} onChange={e => setField('emergencyContactRelationship', e.target.value)} />
                </FieldRow>
              </div>
              <FieldRow label={t('teacherProfile:fields.emergencyContactPhone')} editing>
                <input type="text" value={form.emergencyContactPhone} onChange={e => setField('emergencyContactPhone', e.target.value)} />
              </FieldRow>
            </>
          )}

          {/* --- Step 2: Employment --- */}
          {step === 1 && (
            <>
              <div className="form-row-2">
                <FieldRow label={t('teacherProfile:fields.employeeId')} display={employeeId || t('facultyOnboarding:employeeIdPending')} editing={false} />
                <FieldRow label={t('teacherProfile:fields.department')} editing>
                  <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                    <option value="" disabled>{t('teacherProfile:select')}</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </FieldRow>
              </div>
              <div className="form-row-2">
                <FieldRow label={t('teacherProfile:fields.college')} display={college?.name || t('common:notApplicable')} editing={false} />
                <FieldRow label={t('teacherProfile:fields.designation')} editing>
                  <select value={form.designation} onChange={e => setField('designation', e.target.value)}>
                    <option value="">{t('teacherProfile:select')}</option>
                    {DESIGNATIONS.map(d => <option key={d} value={d}>{t(`teacherProfile:designationOptions.${d}`)}</option>)}
                  </select>
                </FieldRow>
              </div>
              <div className="form-row-2">
                <FieldRow label={t('teacherProfile:fields.employmentType')} editing>
                  <select value={form.employmentType} onChange={e => setField('employmentType', e.target.value)}>
                    <option value="">{t('teacherProfile:select')}</option>
                    {EMPLOYMENT_TYPES.map(v => <option key={v} value={v}>{t(`teacherProfile:employmentTypeOptions.${v}`)}</option>)}
                  </select>
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.dateOfJoining')} editing>
                  <input type="date" value={form.dateOfJoining} onChange={e => setField('dateOfJoining', e.target.value)} />
                </FieldRow>
              </div>
              <div className="form-row-2">
                <FieldRow label={t('teacherProfile:fields.officeRoom')} editing>
                  <input type="text" value={form.officeRoom} onChange={e => setField('officeRoom', e.target.value)} />
                </FieldRow>
                <FieldRow label={t('teacherProfile:fields.status')} editing>
                  <select value={form.status} onChange={e => setField('status', e.target.value)}>
                    {STATUSES.map(v => <option key={v} value={v}>{t(`teacherProfile:statusOptions.${v}`)}</option>)}
                  </select>
                </FieldRow>
              </div>
              <FieldRow label={t('teacherProfile:fields.reportingManager')} editing>
                <select value={form.reportingManagerId} onChange={e => setField('reportingManagerId', e.target.value)}>
                  <option value="">{t('teacherProfile:select')}</option>
                  {teachers.filter(tc => tc.id !== teacherId).map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
                </select>
              </FieldRow>
              {canSeePayroll && (
                <FieldRow label={t('teacherProfile:fields.payrollId')} editing>
                  <input type="text" value={form.payrollId} onChange={e => setField('payrollId', e.target.value)} />
                </FieldRow>
              )}
            </>
          )}

          {/* --- Step 3: Education --- */}
          {step === 2 && teacherId != null && (
            <>
              <TeacherEducationSection teacherId={teacherId} education={data?.education || []} canWrite onChanged={async () => setData(await fetchTeacherProfile(teacherId))} />
              <TeacherCertificationsSection teacherId={teacherId} certifications={data?.certifications || []} canWrite onChanged={async () => setData(await fetchTeacherProfile(teacherId))} />
            </>
          )}

          {/* --- Step 4: Teaching --- */}
          {step === 3 && (
            <>
              <FieldRow label={t('teacherProfile:fields.expertiseAreas')} editing>
                <textarea rows={2} value={form.expertiseAreas} onChange={e => setField('expertiseAreas', e.target.value)} />
              </FieldRow>
              <FieldRow label={t('teacherProfile:fields.researchInterests')} editing>
                <textarea rows={2} value={form.researchInterests} onChange={e => setField('researchInterests', e.target.value)} />
              </FieldRow>
              <FieldRow label={t('teacherProfile:fields.officeHours')} editing>
                <input type="text" placeholder={t('teacherProfile:fields.officeHoursPlaceholder')} value={form.officeHours} onChange={e => setField('officeHours', e.target.value)} />
              </FieldRow>
              {teacherId != null && (
                <TeacherCourseAssignmentsSection
                  teacherId={teacherId} departmentId={departmentId ? Number(departmentId) : null} canWrite
                  onChanged={async () => setData(await fetchTeacherProfile(teacherId))}
                />
              )}
            </>
          )}

          {/* --- Step 5: Documents --- */}
          {step === 4 && teacherId != null && (
            <>
              <div className="panel-header"><div className="panel-title">{t('facultyOnboarding:profilePhoto')}</div></div>
              <TeacherPhotoUpload teacherId={teacherId} name={name} photoPath={data?.profile?.photoPath} canWrite onUploaded={async () => setData(await fetchTeacherProfile(teacherId))} />
              <div style={{ marginTop: 16 }}>
                <TeacherDocumentsSection teacherId={teacherId} documents={data?.documents || []} canWrite onChanged={async () => setData(await fetchTeacherProfile(teacherId))} />
              </div>
            </>
          )}

          {/* --- Step 6: Account --- */}
          {step === 5 && (
            <>
              <label className="field-hint" style={{ display: 'block', marginBottom: 10 }}>
                <input type="checkbox" checked={createLogin} onChange={e => setCreateLogin(e.target.checked)} /> {t('facultyOnboarding:account.createLoginLabel')}
              </label>
              {createLogin && (
                <>
                  <FieldRow label={t('common:fields.email')} editing>
                    <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} />
                  </FieldRow>
                  <FieldRow label={t('common:fields.role')} display={roleLabel('faculty', t, branding)} editing={false} />
                  <div className="field-hint">{t('facultyOnboarding:account.tempPasswordHint')}</div>
                </>
              )}
              {!createLogin && <div className="field-hint">{t('facultyOnboarding:account.skippedHint')}</div>}
            </>
          )}

          {/* Footer belongs to the card, not the page corner — sits directly below the current
              step's last field instead of being flex-stretched to the viewport bottom, where it
              would collide with the fixed bottom-right utility tray (theme/language/bell). */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
            marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)',
          }}>
            <div>
              {step > 0 && <button className="btn-sm" disabled={busy} onClick={handlePrevious}>{t('facultyOnboarding:previous')}</button>}
            </div>
            {step < STEP_KEYS.length - 1 ? (
              <button className={'btn-primary' + (savingStep ? ' btn-loading' : '')} disabled={busy} onClick={handleNext}>
                {savingStep ? <span className="spinner"></span> : t('facultyOnboarding:next')}
              </button>
            ) : (
              <button className={'btn-primary' + (finishing ? ' btn-loading' : '')} disabled={busy} onClick={handleFinish}>
                {finishing ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('facultyOnboarding:finish')}</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}
