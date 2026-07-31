import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchMyTranscript, fetchStudentTranscript } from '../api.js';
import { isForbidden, initials, fmtLongDate } from '../utils.js';

/** A student's official academic transcript: every term's courses/grades plus per-term and
    cumulative GPA, built entirely from GET /transcript/me or GET /transcript/students/:id (see
    api/src/routes/transcript.js) — the server does all the term grouping and GPA math via the
    same computeAcademicSummary() every other GPA read already relies on, so this component is
    purely presentational.

    Reachable two ways, mirroring FinancePage/MyFeesPage's staff-vs-self split:
    - 'my-transcript' (sidebar item, student-only — see permissions.js ROLE_ONLY_SECTIONS) — self
      view, GET /transcript/me.
    - 'transcript' (deliberately ungated — see permissions.js's comment on the student-detail/
      student-profile parameterized-drill-down pattern) — staff view, reached only via a
      studentId-carrying quick action from Students/StudentDetail, GET /transcript/students/:id. */
export default function TranscriptPage() {
  const { t } = useTranslation(['transcript', 'management', 'common']);
  const { currentUser, branding, logoUrl } = useAppData();
  const { activeSection, sectionFocus } = useNavigation();
  const { toast } = useToast();

  const staffMode = activeSection === 'transcript';
  const studentId = staffMode && sectionFocus?.section === 'transcript' && sectionFocus.studentId != null
    ? Number(sectionFocus.studentId)
    : null;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (staffMode) {
      if (!studentId) { setData(null); setForbidden(false); return; }
      setLoading(true); setForbidden(false);
      fetchStudentTranscript(studentId)
        .then(setData)
        .catch(err => { if (isForbidden(err)) setForbidden(true); else toast(err.message, 'error'); })
        .finally(() => setLoading(false));
      return;
    }
    if (activeSection !== 'my-transcript' || currentUser.role !== 'student') return;
    setLoading(true); setForbidden(false);
    fetchMyTranscript()
      .then(setData)
      .catch(err => { if (isForbidden(err)) setForbidden(true); else toast(err.message, 'error'); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, staffMode, studentId, currentUser.role]);

  function renderDocument() {
    if (loading) return <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>;
    if (forbidden) return <div className="field-hint" style={{ padding: 14 }}>{t('common:accessDenied')}</div>;
    if (staffMode && !studentId) return <div className="field-hint" style={{ padding: 14 }}>{t('management:studentDetailPage.noStudentSelected')}</div>;
    if (!data) return <div className="field-hint" style={{ padding: 14 }}>{t('transcript:noData')}</div>;

    return (
      <div className="transcript-doc panel">
        <div className="transcript-header">
          <div className="transcript-org">
            <div className="transcript-org-logo" style={{ background: logoUrl ? 'transparent' : (branding.brandColor || '#4B7FE8') }}>
              {logoUrl ? <img src={logoUrl} alt="" /> : (initials(branding.orgName) || <i className="ti ti-school" aria-hidden="true"></i>)}
            </div>
            <div>
              <div className="transcript-org-name">{branding.orgName || 'UniScheduler'}</div>
              <div className="transcript-org-sub">{t('transcript:officialTranscript')}</div>
            </div>
          </div>
          <div className="transcript-meta">
            <div><span>{t('transcript:printedOn')}</span><strong>{new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</strong></div>
          </div>
        </div>

        <div className="transcript-section">
          <h4>{t('transcript:studentInfo')}</h4>
          <div className="transcript-grid">
            <div><span>{t('transcript:name')}</span><strong>{data.student.name}</strong></div>
            <div><span>{t('transcript:studentId')}</span><strong>{data.student.idNumber || '—'}</strong></div>
            {data.program && <div><span>{t('transcript:program')}</span><strong>{data.program.name}</strong></div>}
            {data.department && <div><span>{t('transcript:department')}</span><strong>{data.department.name}</strong></div>}
            <div><span>{t('transcript:status')}</span><strong>{data.studentStatus}</strong></div>
            {data.graduationDate && <div><span>{t('transcript:graduationDate')}</span><strong>{fmtLongDate(data.graduationDate)}</strong></div>}
          </div>
        </div>

        {!data.terms.length ? (
          <div className="empty-state">{t('transcript:noCourses')}</div>
        ) : data.terms.map(term => (
          <div className="transcript-section" key={term.termId}>
            <h4>{term.termName}</h4>
            <table className="data-table">
              <thead><tr>
                <th>{t('transcript:table.code')}</th>
                <th>{t('transcript:table.course')}</th>
                <th>{t('transcript:table.credits')}</th>
                <th>{t('transcript:table.grade')}</th>
              </tr></thead>
              <tbody>
                {term.courses.map(c => (
                  <tr key={c.code}>
                    <td>{c.code}</td>
                    <td>{c.name}</td>
                    <td>{c.credits}</td>
                    <td>
                      {c.withdrawn ? <span className="pill pill-red" title={t('transcript:withdrawnHint')}>{c.grade}</span>
                        : c.inProgress ? <span className="pill pill-amber">{t('transcript:inProgress')}</span>
                        : (c.grade || '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="transcript-term-summary">
              <span>{t('transcript:termGpa')}: <strong>{term.termGpa != null ? term.termGpa.toFixed(2) : '—'}</strong></span>
              <span>{t('transcript:termCredits')}: <strong>{term.termCredits}</strong></span>
            </div>
          </div>
        ))}

        <div className="transcript-footer">
          <div className="transcript-cumulative">
            <span>{t('transcript:cumulativeGpa')}: <strong>{data.cumulative.gpa != null ? data.cumulative.gpa.toFixed(2) : '—'}</strong></span>
            <span>{t('transcript:completedCredits')}: <strong>{data.cumulative.completedCredits}</strong></span>
            <span>{t('transcript:attemptedCredits')}: <strong>{data.cumulative.attemptedCredits}</strong></span>
          </div>
          {data.gradingScaleLegend?.length > 0 && (
            <div className="transcript-legend">
              <span>{t('transcript:gradingScale')}:</span>
              {data.gradingScaleLegend.map(b => <span key={b.label} className="transcript-legend-item">{b.label} = {b.point}</span>)}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderPage() {
    return (
      <>
        <div className="topbar">
          <i className="ti ti-file-text" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
          <h2>{t('transcript:title')}</h2>
          {data && (
            <div className="topbar-actions no-print">
              <button className="btn-sm" onClick={() => window.print()}>
                <i className="ti ti-printer"></i> {t('transcript:print')}
              </button>
            </div>
          )}
        </div>
        <div id="content">{renderDocument()}</div>
      </>
    );
  }

  return (
    <>
      <Section name="my-transcript">{renderPage()}</Section>
      <Section name="transcript">{renderPage()}</Section>
    </>
  );
}
