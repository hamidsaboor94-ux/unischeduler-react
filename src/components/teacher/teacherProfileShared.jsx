/** Small pieces shared between TeacherProfilePage (view/edit) and FacultyOnboardingPage (the
    guided create flow) — kept here so both stay in sync instead of drifting apart. */

/** Read/edit field row — .form-static in read mode, the given input/select in edit mode.
    Full Profile toggles `editing`; the always-editing onboarding wizard just passes true. */
export function FieldRow({ label, display, editing, children }) {
  return (
    <div className="form-row">
      <div className="form-label">{label}</div>
      {editing ? children : <div className="form-static">{display}</div>}
    </div>
  );
}

const VERIFICATION_PILL = { Verified: 'pill-green', Rejected: 'pill-red', Pending: 'pill-amber' };

export function VerificationBadge({ status, t }) {
  if (!status) return null;
  return <span className={'pill ' + (VERIFICATION_PILL[status] || 'pill-gray')}>{t(`teacherProfile:verification.status.${status}`, status)}</span>;
}

export function ExpiryBadge({ expiryDate, doesNotExpire, t }) {
  if (doesNotExpire || !expiryDate) return null;
  const days = Math.ceil((new Date(expiryDate) - new Date()) / 86400000);
  if (days < 0) return <span className="pill pill-red">{t('teacherProfile:expiry.expired')}</span>;
  if (days <= 30) return <span className="pill pill-amber">{t('teacherProfile:expiry.expiringSoon', { count: days })}</span>;
  return null;
}

export function VerifyActions({ canVerify, status, onVerify, onReject, t }) {
  if (!canVerify || status === 'Verified') return null;
  return (
    <>
      <button className="icon-btn" aria-label={t('teacherProfile:verification.verify')} onClick={onVerify}><i className="ti ti-check" aria-hidden="true"></i></button>
      {status !== 'Rejected' && (
        <button className="icon-btn danger" aria-label={t('teacherProfile:verification.reject')} onClick={onReject}><i className="ti ti-x" aria-hidden="true"></i></button>
      )}
    </>
  );
}

export const DEGREES = ['High School', 'Diploma', "Bachelor's", "Master's", 'MPhil', 'PhD', 'Postdoctoral', 'Other'];
export const DOC_TYPES = [
  'CV', 'National ID', 'Passport', 'certificate', 'Appointment Letter', 'Employment Contract',
  'Experience Certificate', 'Teaching Certificate', 'Professional License', 'Background Verification', 'other',
];

// Same field/option lists the backend's teacherProfile.js PROFILE_FIELDS/DESIGNATIONS/etc.
// validate against — kept here (not duplicated per-page) so TeacherProfilePage (view/edit) and
// FacultyOnboardingPage (guided create) can't drift out of sync with each other.
export const PROFILE_FIELDS = [
  'gender', 'dateOfBirth', 'preferredName', 'fatherName', 'motherName', 'nationality', 'nationalId', 'maritalStatus',
  'phone', 'personalEmail', 'address', 'officialEmail', 'secondaryPhone',
  'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone',
  'permanentAddress', 'city', 'province', 'country', 'postalCode',
  'designation', 'employmentType', 'dateOfJoining', 'status',
  'contractStartDate', 'contractEndDate', 'officeRoom', 'reportingManagerId', 'employeeCategory', 'payrollId', 'workLocation',
  'bio', 'qualifiedSubjects', 'expertiseAreas', 'researchInterests', 'teachingInterests', 'publications', 'awards', 'officeHours',
];
export const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
export const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Divorced', 'Widowed', 'Other'];
export const DESIGNATIONS = [
  'Lecturer', 'Senior Lecturer', 'Instructor', 'Assistant Professor', 'Associate Professor', 'Professor',
  'Teaching Assistant', 'Research Assistant', 'Visiting Professor', 'Visiting Faculty', 'Adjunct Faculty', 'Other',
];
export const EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'visiting', 'adjunct'];
export const STATUSES = ['Active', 'On Leave', 'Suspended', 'Inactive', 'Resigned', 'Retired', 'Terminated'];

export function formStateFromProfile(profile) {
  const state = {};
  for (const f of PROFILE_FIELDS) state[f] = profile?.[f] != null ? String(profile[f]) : '';
  return state;
}
