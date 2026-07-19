import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { fetchBranding, fetchPublicDepartments, submitApplication } from '../api.js';
import { initials } from '../utils.js';

const FIELDS = [
  'fullName', 'fatherName', 'grandfatherName', 'gender', 'dateOfBirth', 'nationality', 'nationalId', 'passportNumber',
  'presentAddress', 'permanentAddress', 'mobileNumber', 'emergencyContact', 'personalEmail',
  'previousSchoolName', 'previousGraduationYear', 'desiredDepartmentId', 'entryTestMarks',
];
const GENDER_OPTIONS = ['Male', 'Female', 'Other'];

function Field({ label, children }) {
  return (
    <div className="form-row">
      <div className="form-label">{label}</div>
      {children}
    </div>
  );
}

/** The public admissions form — reachable without logging in (see PublicEntryScreen.jsx), the
    first unauthenticated form this app has ever had. Captures the exact same fields as the
    Student Profile page (same section grouping too) so an approved applicant's data flows
    straight into their profile with nothing re-typed — see routes/applications.js's approve
    handler, which copies these fields 1:1 into student_profiles. */
export default function PublicApplicationForm({ onBackToLogin }) {
  const { t } = useTranslation(['admissions', 'studentProfile', 'common']);
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();

  const [branding, setBranding] = useState({ orgName: null });
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(Object.fromEntries(FIELDS.map(f => [f, ''])));
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchBranding().then(setBranding).catch(() => {});
    fetchPublicDepartments().then(setDepartments).catch(() => {});
  }, []);

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.fullName.trim()) { toast(t('admissions:form.errors.fullNameRequired'), 'warning'); return; }
    if (!form.personalEmail.trim()) { toast(t('admissions:form.errors.emailRequired'), 'warning'); return; }
    if (!form.desiredDepartmentId) { toast(t('admissions:form.errors.departmentRequired'), 'warning'); return; }
    try {
      const documents = Array.from(fileInputRef.current?.files || []);
      await run(submitApplication({ ...form, documents }));
      setSubmitted(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const orgName = branding.orgName || t('common:appName');

  if (submitted) {
    return (
      <div className="auth-screen">
        <div className="auth-box" style={{ width: 460 }}>
          <div className="auth-heading">
            <i className="ti ti-circle-check" style={{ fontSize: 40, color: 'var(--success)', display: 'block', marginBottom: 10 }} aria-hidden="true"></i>
            <h1>{t('admissions:form.submittedTitle')}</h1>
            <p>{t('admissions:form.submittedBody', { org: orgName })}</p>
          </div>
          <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onBackToLogin}>
            {t('admissions:form.backToLogin')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen" style={{ alignItems: 'flex-start', padding: '40px 16px' }}>
      <div className="auth-box" style={{ width: 760, margin: '0 auto' }}>
        <div className="auth-brand">
          <div className="brand-icon" style={{ background: 'var(--accent)' }}>{initials(orgName)}</div>
          <span className="brand-name">{t('admissions:form.title', { org: orgName })}</span>
        </div>
        <div className="field-hint" style={{ marginBottom: 18 }}>{t('admissions:form.hint')}</div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="panel-title" style={{ marginBottom: 10 }}>{t('studentProfile:sections.personal')}</div>
          <div className="form-row-2">
            <Field label={t('studentProfile:fields.fullName')}><input type="text" required value={form.fullName} onChange={e => set('fullName', e.target.value)} /></Field>
            <Field label={t('studentProfile:fields.fatherName')}><input type="text" value={form.fatherName} onChange={e => set('fatherName', e.target.value)} /></Field>
          </div>
          <div className="form-row-2">
            <Field label={t('studentProfile:fields.grandfatherName')}><input type="text" value={form.grandfatherName} onChange={e => set('grandfatherName', e.target.value)} /></Field>
            <Field label={t('studentProfile:fields.gender')}>
              <select value={form.gender} onChange={e => set('gender', e.target.value)}>
                <option value="">{t('studentProfile:select')}</option>
                {GENDER_OPTIONS.map(g => <option key={g} value={g}>{t(`studentProfile:genderOptions.${g}`)}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-row-2">
            <Field label={t('studentProfile:fields.dateOfBirth')}><input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} /></Field>
            <Field label={t('studentProfile:fields.nationality')}><input type="text" value={form.nationality} onChange={e => set('nationality', e.target.value)} /></Field>
          </div>
          <div className="form-row-2">
            <Field label={t('studentProfile:fields.nationalId')}><input type="text" value={form.nationalId} onChange={e => set('nationalId', e.target.value)} /></Field>
            <Field label={t('studentProfile:fields.passportNumber')}><input type="text" value={form.passportNumber} onChange={e => set('passportNumber', e.target.value)} /></Field>
          </div>

          <hr className="form-divider" />
          <div className="panel-title" style={{ marginBottom: 10 }}>{t('studentProfile:sections.address')}</div>
          <div className="form-row-2">
            <Field label={t('studentProfile:fields.presentAddress')}><textarea rows={2} value={form.presentAddress} onChange={e => set('presentAddress', e.target.value)} /></Field>
            <Field label={t('studentProfile:fields.permanentAddress')}><textarea rows={2} value={form.permanentAddress} onChange={e => set('permanentAddress', e.target.value)} /></Field>
          </div>

          <hr className="form-divider" />
          <div className="panel-title" style={{ marginBottom: 10 }}>{t('studentProfile:sections.contact')}</div>
          <div className="form-row-2">
            <Field label={t('studentProfile:fields.mobileNumber')}><input type="text" value={form.mobileNumber} onChange={e => set('mobileNumber', e.target.value)} /></Field>
            <Field label={t('studentProfile:fields.emergencyContact')}><input type="text" value={form.emergencyContact} onChange={e => set('emergencyContact', e.target.value)} /></Field>
          </div>
          <Field label={t('admissions:form.personalEmailLabel')}>
            <input type="email" required value={form.personalEmail} onChange={e => set('personalEmail', e.target.value)} />
            <div className="field-hint">{t('admissions:form.personalEmailHint')}</div>
          </Field>

          <hr className="form-divider" />
          <div className="panel-title" style={{ marginBottom: 10 }}>{t('studentProfile:sections.educational')}</div>
          <div className="form-row-2">
            <Field label={t('studentProfile:fields.previousSchool')}><input type="text" value={form.previousSchoolName} onChange={e => set('previousSchoolName', e.target.value)} /></Field>
            <Field label={t('studentProfile:fields.previousGraduationYear')}><input type="number" value={form.previousGraduationYear} onChange={e => set('previousGraduationYear', e.target.value)} /></Field>
          </div>
          <div className="form-row-2">
            <Field label={t('admissions:form.desiredDepartmentLabel')}>
              <select required value={form.desiredDepartmentId} onChange={e => set('desiredDepartmentId', e.target.value)}>
                <option value="">{t('studentProfile:select')}</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label={t('studentProfile:fields.entryTestMarks')}>
              <input type="number" step="0.01" value={form.entryTestMarks} onChange={e => set('entryTestMarks', e.target.value)} />
              <div className="field-hint">{t('admissions:form.entryTestHint')}</div>
            </Field>
          </div>

          <hr className="form-divider" />
          <div className="panel-title" style={{ marginBottom: 10 }}>{t('studentProfile:sections.documents')}</div>
          <Field label={t('admissions:form.documentsLabel')}>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" />
            <div className="field-hint">{t('admissions:form.documentsHint')}</div>
          </Field>

          <button className={'btn-primary' + (loading ? ' btn-loading' : '')} type="submit" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
            {loading ? <span className="spinner"></span> : t('admissions:form.submit')}
          </button>
        </form>
        <div className="field-hint" style={{ marginTop: 14, textAlign: 'center' }}>
          <button type="button" className="link-button" onClick={onBackToLogin}>{t('admissions:form.backToLogin')}</button>
        </div>
      </div>
    </div>
  );
}
