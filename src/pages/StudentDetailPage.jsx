import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchStudentProfile, fetchStudentOverview } from '../api.js';
import { fmtDate, isForbidden } from '../utils.js';
import { StatCard } from '../components/ui/StatCard.jsx';
import StudentAvatar from '../components/StudentAvatar.jsx';

const ENROLLMENT_PILL = { Regular: 'pill-green', 'Part-time': 'pill-blue', Probation: 'pill-amber', Withdrawn: 'pill-red' };
const STUDENT_STATUS_PILL = { Active: 'pill-green', Graduated: 'pill-blue', Suspended: 'pill-red', Withdrawn: 'pill-red', 'On Leave': 'pill-amber' };
const APPLICATION_STATUS_PILL = {
  Submitted: 'pill-blue', 'Under Review': 'pill-amber', 'Entry Test Scheduled': 'pill-amber',
  Waitlisted: 'pill-amber', Accepted: 'pill-green', Rejected: 'pill-red',
};
const FINANCE_STATUS_TONE = { cleared: 'positive', partial: 'warning', outstanding: 'neutral', overdue: 'negative', not_billed: 'neutral' };
const ENROLLMENT_STATUS_PILL = { enrolled: 'pill-green', dropped: 'pill-red', waitlisted: 'pill-amber' };

/** The canonical read-mostly 360° view of a student — application, finance summary, and
    enrollment history — composed from data the Students module doesn't duplicate: the editable
    profile fields/documents/GPA stay on StudentProfilePage (linked out to below), this page adds
    exactly what that one doesn't already show. */
export default function StudentDetailPage() {
  const { t } = useTranslation(['management', 'studentProfile', 'finance', 'admissions', 'common']);
  const { sectionFocus, showSection } = useNavigation();
  const { toast } = useToast();
  const na = t('common:notApplicable');

  const studentId = sectionFocus?.section === 'student-detail' && sectionFocus.studentId != null
    ? Number(sectionFocus.studentId)
    : null;

  const [profileData, setProfileData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!studentId) { setProfileData(null); setOverview(null); setForbidden(false); return; }
    setLoading(true);
    setForbidden(false);
    Promise.all([fetchStudentProfile(studentId), fetchStudentOverview(studentId)])
      .then(([p, o]) => { setProfileData(p); setOverview(o); })
      .catch(err => {
        // A 403 means "you can't see this student", not "this student doesn't exist" — render a
        // distinct access-denied state below instead of the generic error toast, which would
        // just repeat what the empty state already says.
        if (isForbidden(err)) { setForbidden(true); return; }
        toast(err.message, 'error');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  if (!studentId) {
    return (
      <Section name="student-detail">
        <div className="topbar">
          <i className="ti ti-users" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
          <h2>{t('management:studentDetailPage.title')}</h2>
        </div>
        <div id="content">
          <div className="field-hint" style={{ padding: 14 }}>{t('management:studentDetailPage.noStudentSelected')}</div>
        </div>
      </Section>
    );
  }

  const money = (n) => `${Number(n || 0).toLocaleString()}${overview?.finance?.currency ? ' ' + overview.finance.currency : ''}`;

  return (
    <Section name="student-detail">
      <div className="topbar">
        <i className="ti ti-users" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('management:studentDetailPage.title')}</h2>
        {profileData && (
          <div className="topbar-actions">
            <button className="btn-sm" onClick={() => showSection('student-profile', { studentId })}>
              <i className="ti ti-id-badge-2"></i> {t('management:studentDetailPage.fullProfile')}
            </button>
          </div>
        )}
      </div>
      <div id="content">
        {loading && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
        {!loading && forbidden && <div className="field-hint" style={{ padding: 14 }}>{t('common:accessDenied')}</div>}
        {!loading && !forbidden && !profileData && <div className="field-hint" style={{ padding: 14 }}>{t('studentProfile:notFound')}</div>}
        {!loading && profileData && overview && (() => {
          const { student, profile, department, program } = profileData;
          const { application, enrollments, finance } = overview;
          return (
            <>
              {student.role !== 'student' && (
                <div className="panel" style={{ padding: 14, marginBottom: 16, borderInlineStart: '4px solid var(--warning, #e0a800)' }}>
                  <strong style={{ color: 'var(--warning, #e0a800)' }}>
                    <i className="ti ti-alert-triangle" aria-hidden="true"></i> {t('management:studentDetailPage.roleMismatchBanner', { role: student.role })}
                  </strong>
                </div>
              )}
              <div className="panel profile-header-panel">
                <StudentAvatar studentId={student.id} name={student.name || student.email} photoPath={profile.photoPath} size="lg" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="profile-header-name">{student.name || na}</div>
                  <div className="profile-header-meta">
                    {student.idNumber && <span className="pill pill-gray">{student.idNumber}</span>}
                    {department?.name && <span className="pill pill-gray">{department.name}</span>}
                    {program?.name && <span className="pill pill-gray">{program.name}</span>}
                    {profile.enrollmentStatus && (
                      <span className={'pill ' + (ENROLLMENT_PILL[profile.enrollmentStatus] || 'pill-gray')}>
                        {t(`studentProfile:enrollmentOptions.${profile.enrollmentStatus}`)}
                      </span>
                    )}
                    {profile.studentStatus && (
                      <span className={'pill ' + (STUDENT_STATUS_PILL[profile.studentStatus] || 'pill-gray')}>
                        {t(`studentProfile:studentStatusOptions.${profile.studentStatus}`)}
                      </span>
                    )}
                  </div>
                  <div className="field-hint" style={{ margin: '4px 0 0' }}>{student.email}</div>
                </div>
              </div>

              {/* --- Application --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('management:studentDetailPage.sections.application')}</div></div>
                {!application && <div className="field-hint" style={{ padding: '10px 0' }}>{t('management:studentDetailPage.noApplication')}</div>}
                {application && (
                  <div className="form-row-2">
                    <div className="form-row">
                      <div className="form-label">{t('management:studentDetailPage.fields.applicationStatus')}</div>
                      <div className="form-static">
                        <span className={'pill ' + (APPLICATION_STATUS_PILL[application.status] || 'pill-gray')}>
                          {t(`admissions:statuses.${application.status}`, application.status)}
                        </span>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-label">{t('management:studentDetailPage.fields.applicationSource')}</div>
                      <div className="form-static">{t(`admissions:page.source.${application.source}`, application.source)}</div>
                    </div>
                    <div className="form-row">
                      <div className="form-label">{t('management:studentDetailPage.fields.applicationDecidedAt')}</div>
                      <div className="form-static">{application.decidedAt ? fmtDate(application.decidedAt.split(' ')[0]) : na}</div>
                    </div>
                    <div className="form-row">
                      <div className="form-label">{t('management:studentDetailPage.fields.applicationEmail')}</div>
                      <div className="form-static">{application.personalEmail || na}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* --- Finance summary --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('management:studentDetailPage.sections.finance')}</div></div>
                <div className="stat-grid" style={{ marginBottom: 0 }}>
                  <StatCard
                    icon="ti-cash" hue={finance.balance > 0 ? 'red' : 'teal'}
                    label={t('management:studentDetailPage.fields.balance')}
                    value={money(finance.balance)}
                    delta={{
                      label: t(`finance:financePage.status.${finance.status}`, finance.status),
                      tone: FINANCE_STATUS_TONE[finance.status] || 'neutral',
                    }}
                  />
                  <StatCard icon="ti-receipt" hue="indigo" label={t('management:studentDetailPage.fields.totalCharged')} value={money(finance.totalCharged)} />
                  <StatCard icon="ti-check" hue="teal" label={t('management:studentDetailPage.fields.totalPaid')} value={money(finance.totalPaid)} />
                </div>
              </div>

              {/* --- Enrollments --- */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('management:studentDetailPage.sections.enrollments')}</div></div>
                {enrollments.length === 0 && <div className="field-hint" style={{ padding: '10px 0' }}>{t('management:studentDetailPage.noEnrollments')}</div>}
                {enrollments.length > 0 && (
                  <table className="data-table">
                    <thead><tr>
                      <th>{t('management:studentDetailPage.columns.course')}</th>
                      <th>{t('management:studentDetailPage.columns.term')}</th>
                      <th>{t('management:studentDetailPage.columns.enrollmentStatus')}</th>
                      <th>{t('management:studentDetailPage.columns.grade')}</th>
                    </tr></thead>
                    <tbody>
                      {enrollments.map(e => (
                        <tr key={e.id}>
                          <td>{e.courseCode} — {e.courseName}</td>
                          <td>{e.termName || na}</td>
                          <td><span className={'pill ' + (ENROLLMENT_STATUS_PILL[e.status] || 'pill-gray')}>{t(`management:studentDetailPage.enrollmentStatus.${e.status}`, e.status)}</span></td>
                          <td>{e.grade || na}</td>
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
