import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { fetchMyNotices, fetchMyFinance, fetchMyAttendance, fetchStudentProfile, fetchCurrentProgression } from '../api.js';
import { PRIORITY_PILL } from '../noticeConstants.js';
import { StatCard } from './ui/StatCard.jsx';
import {
  COLOR_HEX, courseColor, courseById, roomName, teacherName, termName,
  timeToMinutes, addMinutes, fmt12Hour,
} from '../utils.js';

const RECENT_NOTICES_LIMIT = 2;
const ATTENDANCE_WARN_THRESHOLD = 75;
const SEMESTER_STATUS_PILL = {
  'In Progress': 'pill-amber', 'Awaiting Results': 'pill-amber', 'On Hold': 'pill-amber',
  Passed: 'pill-green', 'Graduation Eligible': 'pill-green', Failed: 'pill-red',
};

function fmtDateTime(v) {
  if (!v) return null;
  return new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Student's own landing dashboard — a read-only summary (GPA, fee balance, attendance rate,
    today's classes, recent announcements, quick links) that links out to the full pages for
    anything actionable. Mirrors SuperAdminDashboard's role-specific-dashboard pattern; sourced
    entirely from endpoints that already exist for MyFeesPage/MyGradesPage/MyAttendancePage/
    StudentProfilePage/AnnouncementsPage, so this never introduces new backend surface.

    Layout: a KPI strip (GPA term+cumulative, attendance, credits, fee balance) followed by a
    two-column body — "This semester" + "Enrolled courses" on the left, "Today" + "Quick links" +
    "Announcements" stacked on the right — collapsing to one column at the same breakpoint the
    rest of the app uses (.panel-row's max-width:860px rule). Every value here comes from data
    already fetched for this page or already loaded in AppDataContext (courses/slots/rooms/
    teachers/myFinalGrades/terms) — nothing is invented, and fields with no real value yet (e.g.
    an in-progress semester's termGpa, not computed until it's evaluated) render as "—". */
export default function StudentDashboard() {
  const { t } = useTranslation(['dashboard', 'announcements', 'finance', 'studentProfile', 'common']);
  const { currentUser, courses, slots, rooms, teachers, myEnrollments, myFinalGrades, terms, activeTermId } = useAppData();
  const { showSection } = useNavigation();

  const [notices, setNotices] = useState([]);
  const [finance, setFinance] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [profile, setProfile] = useState(null);
  const [progression, setProgression] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchMyNotices().catch(() => []),
      fetchMyFinance().catch(() => null),
      fetchMyAttendance().catch(() => []),
      fetchStudentProfile(currentUser.id).catch(() => null),
      fetchCurrentProgression(currentUser.id).catch(() => null),
    ]).then(([n, f, a, p, prog]) => {
      if (cancelled) return;
      setNotices(n);
      setFinance(f);
      setAttendance(a);
      setProfile(p);
      setProgression(prog);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentUser.id]);

  const enrolledCourseIds = new Set(myEnrollments.filter(e => e.status === 'enrolled').map(e => e.id));
  const mySlots = slots.filter(s => enrolledCourseIds.has(s.courseId));
  const dayIdx = new Date().getDay();
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIdx];
  const todaySlots = mySlots.slice().filter(s => s.day === day).sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  const attendancePct = useMemo(() => {
    if (attendance.length === 0) return null;
    const present = attendance.filter(a => a.status === 'present' || a.status === 'late').length;
    return Math.round((present / attendance.length) * 100);
  }, [attendance]);

  const enrolledCourseRows = useMemo(() => (
    [...enrolledCourseIds].map(id => courseById(courses, id)).filter(Boolean).map(course => {
      const slot = mySlots.find(s => s.courseId === course.id);
      const grade = myFinalGrades.get(course.id);
      return {
        course,
        room: slot ? roomName(rooms, slot.roomId) : null,
        instructor: teacherName(teachers, course.teacherId),
        letterGrade: grade?.letterGrade || null,
        hasAnyScore: !!grade?.hasAnyScore,
      };
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [myEnrollments, courses, slots, myFinalGrades, rooms, teachers]);

  const recentNotices = notices.slice(0, RECENT_NOTICES_LIMIT);
  const money = (n) => `${Number(n || 0).toLocaleString()}${finance?.currency ? ' ' + finance.currency : ''}`;
  const hasHold = !!finance?.hasHold;
  const feesConfigured = !!finance?.term?.generated;
  const studentName = currentUser.name || currentUser.email;
  const currentTermName = termName(terms, activeTermId);
  const cgpa = progression?.cgpa ?? profile?.gpa ?? null;
  const termGpa = progression?.record?.termGpa ?? null;
  const semesterStatus = profile?.profile?.semesterStatus || 'In Progress';
  const semesterStatusPill = SEMESTER_STATUS_PILL[semesterStatus] || 'pill-amber';
  const failedCount = progression?.courses?.filter(c => c.grade === 'F').length || 0;
  const creditsPct = progression?.creditsAttempted
    ? Math.min(100, Math.round((progression.creditsEarned / progression.creditsAttempted) * 100))
    : 0;

  return (
    <>
      <div className="dash-welcome-row">
        <div>
          <div className="dash-welcome-title">{t('dashboard.studentDashboard.welcome.title', { name: studentName })}</div>
          <div className="panel-subtitle">{t('dashboard.studentDashboard.welcome.subtitle')}</div>
        </div>
        {currentTermName !== '—' && (
          <span className="pill pill-blue dash-semester-pill">
            <i className="ti ti-calendar-event" aria-hidden="true"></i> {currentTermName}
          </span>
        )}
      </div>

      <div className="kpi-strip">
        <div className="kpi-card">
          <div className="kpi-card-top">
            <div className="kpi-chip kpi-chip--amber"><i className="ti ti-school" aria-hidden="true"></i></div>
          </div>
          <div className="kpi-label">{t('dashboard.studentDashboard.stats.gpa')}</div>
          <div className="kpi-split">
            <div className="kpi-split-item">
              <div className="kpi-value kpi-value--split">{termGpa != null ? termGpa.toFixed(2) : '—'}</div>
              <div className="kpi-sub">{t('dashboard.studentDashboard.stats.gpaTerm')}</div>
            </div>
            <div className="kpi-split-divider"></div>
            <div className="kpi-split-item">
              <div className="kpi-value kpi-value--split">{cgpa != null ? cgpa.toFixed(2) : '—'}</div>
              <div className="kpi-sub">{t('dashboard.studentDashboard.stats.gpaCumulative')}</div>
            </div>
          </div>
        </div>

        <StatCard
          icon="ti-clipboard-check" hue={attendancePct == null ? 'indigo' : attendancePct < ATTENDANCE_WARN_THRESHOLD ? 'red' : 'teal'}
          label={t('dashboard.studentDashboard.stats.attendance')}
          value={attendancePct != null ? `${attendancePct}%` : '—'}
          sub={t('dashboard.studentDashboard.stats.attendanceSub')}
        />

        <StatCard
          icon="ti-certificate" hue="teal"
          label={t('dashboard.studentDashboard.stats.credits')}
          value={progression ? `${progression.creditsEarned} / ${progression.creditsAttempted}` : '—'}
          sub={t('dashboard.studentDashboard.stats.creditsSub')}
        >
          {progression?.creditsAttempted > 0 && (
            <div className="profile-progress-bar"><div className="profile-progress-fill" style={{ width: `${creditsPct}%` }}></div></div>
          )}
        </StatCard>

        <StatCard
          icon="ti-cash" hue={!feesConfigured ? 'indigo' : hasHold ? 'red' : 'teal'}
          label={t('dashboard.studentDashboard.stats.balance')}
          value={feesConfigured ? money(finance.balance) : '—'}
          delta={{
            label: !feesConfigured
              ? t('dashboard.studentDashboard.stats.noFees')
              : hasHold ? t('dashboard.studentDashboard.stats.balanceDue') : t('dashboard.studentDashboard.stats.balanceClear'),
            tone: !feesConfigured ? 'neutral' : hasHold ? 'negative' : 'positive',
          }}
        />
      </div>

      <div className="panel-row dash-two-col">
        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.studentDashboard.semester.title')}</div>
                <div className="panel-subtitle">{t('dashboard.studentDashboard.semester.subtitle')}</div>
              </div>
              <span className={'pill ' + semesterStatusPill}>{t(`studentProfile:semesterStatusOptions.${semesterStatus}`, semesterStatus)}</span>
            </div>
            <div className="stat-grid" style={{ marginBottom: 0 }}>
              <StatCard
                icon="ti-award" hue="teal"
                label={t('dashboard.studentDashboard.semester.credits')}
                value={progression ? `${progression.creditsEarned} / ${progression.creditsAttempted}` : '—'}
              />
              <StatCard
                icon="ti-report-analytics" hue="indigo"
                label={t('dashboard.studentDashboard.semester.coursesGraded')}
                value={progression ? `${progression.gradedCount} / ${progression.totalCount}` : '—'}
              />
              <StatCard
                icon="ti-alert-triangle" hue={failedCount ? 'red' : 'indigo'}
                label={t('dashboard.studentDashboard.semester.failedCourses')}
                value={failedCount}
              />
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.studentDashboard.enrolled.title', { count: enrolledCourseRows.length })}</div>
              </div>
              <button className="btn-sm" onClick={() => showSection('myschedule')}>{t('dashboard.fullView')}</button>
            </div>
            <div className="exam-grid">
              {enrolledCourseRows.length === 0 && (
                <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.studentDashboard.enrolled.empty')}</div>
              )}
              {enrolledCourseRows.map(row => (
                <div
                  className="exam-row" key={row.course.id}
                  style={{ borderInlineStart: `3px solid ${COLOR_HEX[courseColor(row.course.id)]}`, cursor: 'default' }}
                >
                  <span className="pill pill-gray">{row.course.code}</span>
                  <div className="exam-name">{row.course.name}</div>
                  <div className="exam-meta">{row.instructor} · {row.room || '—'}</div>
                  <span className={'pill ' + (row.letterGrade ? 'pill-green' : row.hasAnyScore ? 'pill-amber' : 'pill-gray')}>
                    {row.letterGrade || (row.hasAnyScore
                      ? t('dashboard.studentDashboard.enrolled.inProgress')
                      : t('dashboard.studentDashboard.enrolled.notYetGraded'))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.todayPanel.title', { day: t('common:days.' + day) })}</div>
                <div className="panel-subtitle">{t('dashboard.todayPanel.subtitle')}</div>
              </div>
              <button className="btn-sm" onClick={() => showSection('myschedule')}>{t('dashboard.fullView')}</button>
            </div>
            <div className="exam-grid">
              {todaySlots.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.todayPanel.empty')}</div>}
              {todaySlots.map(s => {
                const course = courseById(courses, s.courseId);
                if (!course) return null;
                const end = addMinutes(s.time, s.durationMinutes || 60);
                return (
                  <div className="exam-row" key={s.id} style={{ borderInlineStart: `3px solid ${COLOR_HEX[courseColor(course.id)]}`, cursor: 'default' }}>
                    <div className="exam-code">{course.code}</div>
                    <div className="exam-name">{course.name}</div>
                    <div className="exam-meta">{fmt12Hour(s.time)}–{fmt12Hour(end)} · {roomName(rooms, s.roomId)} · {teacherName(teachers, course.teacherId)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">{t('dashboard.studentDashboard.quickLinks.title')}</div>
            </div>
            <div className="quick-link-tiles">
              <button className="course-action-tile" onClick={() => showSection('my-fees')}>
                <i className="ti ti-cash course-action-tile-icon" aria-hidden="true"></i>
                <span className="course-action-tile-label">{t('dashboard.studentDashboard.quickLinks.myFees')}</span>
              </button>
              <button className="course-action-tile" onClick={() => showSection('mygrades')}>
                <i className="ti ti-report-analytics course-action-tile-icon" aria-hidden="true"></i>
                <span className="course-action-tile-label">{t('dashboard.studentDashboard.quickLinks.myGrades')}</span>
              </button>
              <button className="course-action-tile" onClick={() => showSection('my-attendance')}>
                <i className="ti ti-clipboard-check course-action-tile-icon" aria-hidden="true"></i>
                <span className="course-action-tile-label">{t('dashboard.studentDashboard.quickLinks.myAttendance')}</span>
              </button>
              <button className="course-action-tile" onClick={() => showSection('catalog')}>
                <i className="ti ti-book course-action-tile-icon" aria-hidden="true"></i>
                <span className="course-action-tile-label">{t('dashboard.studentDashboard.quickLinks.catalog')}</span>
              </button>
              <button className="course-action-tile" onClick={() => showSection('student-profile')} style={{ gridColumn: '1 / -1' }}>
                <i className="ti ti-id-badge-2 course-action-tile-icon" aria-hidden="true"></i>
                <span className="course-action-tile-label">{t('dashboard.studentDashboard.quickLinks.myProfile')}</span>
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.studentDashboard.announcements.title')}</div>
                <div className="panel-subtitle">{t('dashboard.studentDashboard.announcements.subtitle')}</div>
              </div>
              <button className="btn-sm" onClick={() => showSection('announcements')}>{t('dashboard.fullView')}</button>
            </div>
            <div className="notif-panel-list">
              {!loading && recentNotices.length === 0 && (
                <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.studentDashboard.announcements.empty')}</div>
              )}
              {recentNotices.map(n => (
                <div
                  key={n.id} className="notif-item" style={{ cursor: 'pointer' }}
                  onClick={() => showSection('announcements', { noticeId: n.id })}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {n.pinned && <i className="ti ti-pin" aria-hidden="true"></i>}
                    <strong>{n.title}</strong>
                    <span className={'pill ' + (PRIORITY_PILL[n.priority] || 'pill-gray')}>{t(`announcements:priorities.${n.priority}`)}</span>
                    {!n.readAt && <span className="pill pill-blue">{t('announcements:mine.unread')}</span>}
                  </div>
                  <div className="notif-item-time">{n.createdByName} · {fmtDateTime(n.publishedAt)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
