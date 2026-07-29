import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import ConflictItem from '../components/ConflictItem.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useAutoSchedule } from '../hooks/useSchedulingActions.js';
import { fetchApplications } from '../api.js';
import {
  COLOR_HEX, courseColor, courseById, roomName, teacherName,
  timeToMinutes, addMinutes, fmt12Hour, fmtDate, examStatus, enrolledCount, isoDateLocal,
} from '../utils.js';

const PENDING_APPLICATION_STATUSES = new Set(['Submitted', 'Under Review', 'Entry Test Scheduled', 'Waitlisted']);

export default function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'admissions', 'common']);
  const {
    currentUser, courses, slots, slotExceptions, exams, rooms, teachers, terms, activeTermId,
    conflictsData, courseRosters, notifications, dismissNotification,
  } = useAppData();
  const { showSection } = useNavigation();
  const { openModal } = useModal();
  const { autoScheduleAll, loading } = useAutoSchedule();

  const isAdmin = currentUser.role === 'admin';
  const unreadNotifications = notifications.filter(n => !n.isRead);

  // Applications aren't part of the global app-data store (only admin ever touches them), so
  // this is its own small fetch — guarded to admin-only, same reasoning as every other
  // admin-only fetch in this app (see StudentProfilePage.jsx, ReportsPage.jsx).
  const [pendingApplicationsCount, setPendingApplicationsCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    fetchApplications().then(list => {
      setPendingApplicationsCount(list.filter(a => PENDING_APPLICATION_STATUSES.has(a.status)).length);
    }).catch(() => {});
  }, [isAdmin]);

  const uniqueEnrolled = new Set([...courseRosters.values()].flat().filter(r => r.status === 'enrolled').map(r => r.studentId));

  const dayIdx = new Date().getDay();
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIdx];
  const todaySlots = slots.filter(s => s.day === day).slice().sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  const upcoming = exams.filter(e => e.date).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 5);

  // ---------- "Today at a glance" (admin) — same today-specific exception handling as
  // WeeklyCalendar's dated view, condensed to a count instead of a card per session. ----------
  const todayIso = isoDateLocal(new Date());
  const todayExceptions = slotExceptions.filter(x => x.date === todayIso || x.newDate === todayIso);
  const cancelledSlotIds = new Set(todayExceptions.filter(x => x.kind === 'cancelled' && x.date === todayIso).map(x => x.slotId));
  const movedAwaySlotIds = new Set(todayExceptions.filter(x => x.kind === 'rescheduled' && x.date === todayIso).map(x => x.slotId));
  const regularToday = slots.filter(s => s.day === day && !movedAwaySlotIds.has(s.id)).map(s => ({ time: s.time, cancelled: cancelledSlotIds.has(s.id) }));
  const movedInToday = todayExceptions.filter(x => x.kind === 'rescheduled' && x.newDate === todayIso).map(x => ({ time: x.newTime, cancelled: false }));
  const allToday = [...regularToday, ...movedInToday];
  const cancelledToday = allToday.filter(x => x.cancelled).length;
  const nowMinutes = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const nextClassToday = allToday
    .filter(x => !x.cancelled && timeToMinutes(x.time) > nowMinutes)
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))[0];

  const glanceParts = [];
  if (allToday.length === 0) {
    glanceParts.push(t('dashboard.todayGlance.noClasses'));
  } else {
    glanceParts.push(t('dashboard.todayGlance.classesCount', { count: allToday.length }));
    if (cancelledToday > 0) glanceParts.push(t('dashboard.todayGlance.cancelledCount', { count: cancelledToday }));
    glanceParts.push(nextClassToday
      ? t('dashboard.todayGlance.nextIn', { minutes: timeToMinutes(nextClassToday.time) - nowMinutes })
      : t('dashboard.todayGlance.allDone'));
  }
  const glanceSummary = glanceParts.join(' · ');

  // ---------- "Needs attention" (admin) — every actionable admin item already tracked
  // elsewhere in the system, each linking straight to where it gets resolved. ----------
  const activeTerm = terms.find(term => term.id === activeTermId);
  const overLimitStudents = [];
  if (activeTerm?.creditLimit != null) {
    const creditsByStudent = new Map();
    const namesByStudent = new Map();
    courses.forEach(c => {
      (courseRosters.get(c.id) || []).filter(r => r.status === 'enrolled').forEach(r => {
        creditsByStudent.set(r.studentId, (creditsByStudent.get(r.studentId) || 0) + (c.credits || 0));
        namesByStudent.set(r.studentId, r.name);
      });
    });
    creditsByStudent.forEach((total, studentId) => {
      if (total > activeTerm.creditLimit) overLimitStudents.push({ studentId, name: namesByStudent.get(studentId), total });
    });
    overLimitStudents.sort((a, b) => b.total - a.total);
  }
  const coursesNoTeacher = courses.filter(c => c.teacherId == null);
  const unscheduledExamsCount = exams.filter(e => !e.date).length;
  const conflictIssues = [
    ...conflictsData.critical.map(c => ({ issue: c, severity: 'critical' })),
    ...conflictsData.warnings.map(w => ({ issue: w, severity: 'warning' })),
  ];
  const needsAttentionCount = conflictIssues.length + overLimitStudents.length
    + (unscheduledExamsCount > 0 ? 1 : 0) + (coursesNoTeacher.length > 0 ? 1 : 0)
    + (pendingApplicationsCount > 0 ? 1 : 0);

  return (
    <Section name="dashboard">
      <div className="topbar">
        <i className="ti ti-layout-dashboard" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('dashboard.title')}</h2>
        <div className="topbar-actions">
          {isAdmin && (
            <button className="btn-sm" onClick={() => openModal('course')}><i className="ti ti-plus"></i> {t('dashboard.newCourse')}</button>
          )}
          {isAdmin && <div className="topbar-divider"></div>}
          {isAdmin && (
            <button className={'btn-gold' + (loading ? ' btn-loading' : '')} onClick={() => autoScheduleAll()} disabled={loading}>
              {loading ? <span className="spinner"></span> : <><i className="ti ti-wand"></i> {t('dashboard.autoSchedule')}</>}
            </button>
          )}
        </div>
      </div>
      <div id="content">
        {unreadNotifications.length > 0 && (
          <div className="dash-notice-panel">
            {unreadNotifications.map(n => (
              <div className="dash-notice" key={n.id}>
                <i className="ti ti-calendar-off" aria-hidden="true"></i>
                <div className="dash-notice-msg">{n.message}</div>
                <button className="icon-btn" aria-label={t('dashboard.dismiss')} onClick={() => dismissNotification(n.id)}>
                  <i className="ti ti-x" aria-hidden="true"></i>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="stat-grid">
          <div className="stat-card stat-accent-blue">
            <div className="s-icon s-blue"><i className="ti ti-book-2"></i></div>
            <div className="stat-label">{currentUser.role === 'faculty' ? t('dashboard.statCards.myCourses') : t('dashboard.statCards.totalCourses')}</div>
            <div className="stat-value">{courses.length}</div>
            <div className="stat-sub ok"><i className="ti ti-trending-up" style={{ fontSize: 10 }}></i> {t('dashboard.statCards.liveCount')}</div>
          </div>
          <div className="stat-card stat-accent-green">
            <div className="s-icon s-green"><i className="ti ti-users"></i></div>
            <div className="stat-label">{t('dashboard.statCards.enrolledStudents')}</div>
            <div className="stat-value">{uniqueEnrolled.size}</div>
            <div className="stat-sub ok"><i className="ti ti-check" style={{ fontSize: 10 }}></i> {t('dashboard.statCards.uniqueStudents')}</div>
          </div>
          <div className="stat-card stat-accent-gold">
            <div className="s-icon s-gold"><i className="ti ti-writing"></i></div>
            <div className="stat-label">{t('dashboard.statCards.scheduledExams')}</div>
            <div className="stat-value">{exams.filter(e => e.date).length}</div>
            <div className="stat-sub warn"><i className="ti ti-clock" style={{ fontSize: 10 }}></i> {t('dashboard.statCards.unscheduledCount', { count: exams.filter(e => !e.date).length })}</div>
          </div>
          {isAdmin && (
            <div className="stat-card stat-accent-purple">
              <div className="s-icon s-purple"><i className="ti ti-user"></i></div>
              <div className="stat-label">{t('dashboard.statCards.totalFaculty')}</div>
              <div className="stat-value">{teachers.length}</div>
              <div className="stat-sub ok"><i className="ti ti-trending-up" style={{ fontSize: 10 }}></i> {t('dashboard.statCards.liveCount')}</div>
            </div>
          )}
          {isAdmin && (
            <div className="stat-card stat-accent-red">
              <div className="s-icon s-red"><i className="ti ti-alert-triangle"></i></div>
              <div className="stat-label">{t('dashboard.statCards.activeConflicts')}</div>
              <div className="stat-value">{conflictsData.critical.length + conflictsData.warnings.length}</div>
              <div className="stat-sub bad"><i className="ti ti-alert-circle" style={{ fontSize: 10 }}></i> {t('dashboard.statCards.needsReview')}</div>
            </div>
          )}
          {isAdmin && (
            <div className="stat-card stat-accent-gold" style={{ cursor: 'pointer' }} onClick={() => showSection('applications')}>
              <div className="s-icon s-gold"><i className="ti ti-clipboard-list"></i></div>
              <div className="stat-label">{t('admissions:dashboard.pendingApplications')}</div>
              <div className="stat-value">{pendingApplicationsCount}</div>
              <div className="stat-sub warn"><i className="ti ti-clock" style={{ fontSize: 10 }}></i> {t('admissions:dashboard.awaitingReview')}</div>
            </div>
          )}
        </div>

        {isAdmin ? (
          <>
            <div className="panel dash-glance-panel">
              <div className="s-icon s-blue" style={{ flexShrink: 0 }}><i className="ti ti-calendar-event"></i></div>
              <div style={{ minWidth: 0 }}>
                <div className="panel-title">{t('dashboard.todayGlance.title', { day: t('common:days.' + day) })}</div>
                <div className="dash-glance-summary">{glanceSummary}</div>
              </div>
              <button className="btn-sm" style={{ marginInlineStart: 'auto', flexShrink: 0 }} onClick={() => showSection('timetable')}>{t('dashboard.fullView')}</button>
            </div>

            <div className="panel" id="dash-needs-attention">
              <div className="panel-header">
                <div>
                  <div className="panel-title">{t('dashboard.needsAttention.title')}</div>
                  <div className="panel-subtitle">{t('dashboard.needsAttention.subtitle')}</div>
                </div>
              </div>
              <div className="alert-list">
                {conflictIssues.slice(0, 3).map((it, i) => <ConflictItem key={'c' + i} issue={it.issue} severity={it.severity} />)}
                {conflictIssues.length > 3 && (
                  <button className="btn-sm" onClick={() => showSection('conflicts')}>
                    {t('dashboard.needsAttention.viewAllConflicts', { count: conflictIssues.length })}
                  </button>
                )}
                {overLimitStudents.slice(0, 3).map(s => (
                  <div key={'ol' + s.studentId} className="alert-item alert-warn" onClick={() => showSection('enrollment')}>
                    <i className="ti ti-alert-triangle" style={{ fontSize: 18 }}></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">{t('dashboard.needsAttention.overLimitTitle', { name: s.name })}</div>
                      <div className="alert-desc">{t('dashboard.needsAttention.overLimitDesc', { total: s.total, limit: activeTerm.creditLimit })}</div>
                    </div>
                    <span className="pill pill-amber">{t('dashboard.needsAttention.overLimitPill')}</span>
                  </div>
                ))}
                {overLimitStudents.length > 3 && (
                  <button className="btn-sm" onClick={() => showSection('enrollment')}>
                    {t('dashboard.needsAttention.viewAllOverLimit', { count: overLimitStudents.length })}
                  </button>
                )}
                {unscheduledExamsCount > 0 && (
                  <div className="alert-item alert-info" onClick={() => showSection('exams')}>
                    <i className="ti ti-calendar-exclamation" style={{ fontSize: 18 }}></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">{t('dashboard.needsAttention.unscheduledExamsTitle', { count: unscheduledExamsCount })}</div>
                      <div className="alert-desc">{t('dashboard.needsAttention.unscheduledExamsDesc')}</div>
                    </div>
                    <span className="pill pill-blue">{t('dashboard.needsAttention.actionPill')}</span>
                  </div>
                )}
                {pendingApplicationsCount > 0 && (
                  <div className="alert-item alert-info" onClick={() => showSection('applications')}>
                    <i className="ti ti-clipboard-list" style={{ fontSize: 18 }}></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">{t('admissions:dashboard.needsAttentionTitle', { count: pendingApplicationsCount })}</div>
                      <div className="alert-desc">{t('admissions:dashboard.needsAttentionDesc')}</div>
                    </div>
                    <span className="pill pill-blue">{t('dashboard.needsAttention.actionPill')}</span>
                  </div>
                )}
                {coursesNoTeacher.length > 0 && (
                  <div className="alert-item alert-info" onClick={() => showSection('courses')}>
                    <i className="ti ti-user-question" style={{ fontSize: 18 }}></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">{t('dashboard.needsAttention.noTeacherTitle', { count: coursesNoTeacher.length })}</div>
                      <div className="alert-desc">{t('dashboard.needsAttention.noTeacherDesc')}</div>
                    </div>
                    <span className="pill pill-blue">{t('dashboard.needsAttention.actionPill')}</span>
                  </div>
                )}
                {needsAttentionCount === 0 && (
                  <div className="dash-all-clear">
                    <i className="ti ti-circle-check" aria-hidden="true"></i> {t('dashboard.needsAttention.allClear')}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="panel-row">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">{t('dashboard.todayPanel.title', { day: t('common:days.' + day) })}</div>
                  <div className="panel-subtitle">{t('dashboard.todayPanel.subtitle')}</div>
                </div>
                <button className="btn-sm" onClick={() => showSection('timetable')}>{t('dashboard.fullView')}</button>
              </div>
              <div className="exam-grid">
                {todaySlots.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.todayPanel.empty')}</div>}
                {todaySlots.map(s => {
                  const course = courseById(courses, s.courseId);
                  if (!course) return null;
                  const end = addMinutes(s.time, s.durationMinutes || 60);
                  return (
                    <div className="exam-row" key={s.id} onClick={() => openModal('slot', s.id)}>
                      <div className="exam-dot" style={{ background: COLOR_HEX[courseColor(course.id)] }}></div>
                      <div className="exam-code">{course.code}</div>
                      <div className="exam-name">{course.name}</div>
                      <div className="exam-meta">{fmt12Hour(s.time)}–{fmt12Hour(end)} · {roomName(rooms, s.roomId)} · {teacherName(teachers, course.teacherId)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('dashboard.upcomingExams.title')}</div>
              <div className="panel-subtitle">{t('dashboard.upcomingExams.subtitle')}</div>
            </div>
            <button className="btn-sm" onClick={() => showSection('exams')}>{t('dashboard.upcomingExams.manageAll')}</button>
          </div>
          <div className="exam-grid">
            {upcoming.map(e => {
              const course = courseById(courses, e.courseId);
              if (!course) return null;
              const status = examStatus(e, conflictsData);
              const isIssue = status.key !== 'confirmed';
              const statusLabel = t(`common:status.${status.key}`);
              return (
                <div
                  className="exam-row" key={e.id}
                  style={isIssue ? { borderColor: 'var(--danger)', background: 'var(--danger-bg)' } : undefined}
                  onClick={() => openModal('exam', e.id)}
                >
                  <div className="exam-dot" style={{ background: COLOR_HEX[courseColor(course.id)] }}></div>
                  <div className="exam-code">{course.code}</div>
                  <div className="exam-name" style={isIssue ? { color: 'var(--danger)' } : undefined}>
                    {isIssue ? t('dashboard.upcomingExams.nameWithStatus', { name: course.name, status: statusLabel }) : course.name}
                  </div>
                  <div className="exam-meta" style={isIssue ? { color: 'var(--danger)' } : undefined}>
                    {t('dashboard.upcomingExams.meta', {
                      date: fmtDate(e.date),
                      time: fmt12Hour(e.time),
                      room: roomName(rooms, e.roomId),
                      count: enrolledCount(courseRosters, course.id),
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}
