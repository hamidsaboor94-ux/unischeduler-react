import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { StatCard } from './ui/StatCard.jsx';
import {
  COLOR_HEX, courseColor, courseById, roomName,
  timeToMinutes, addMinutes, fmt12Hour,
} from '../utils.js';

/** Faculty's landing dashboard — scoped entirely to the logged-in teacher's own sections. No new
    backend surface: GET /courses and GET /exams already restrict to the caller's own courses for
    a faculty user (ownership.js's courseScopeClause / scopeExamsForUser), and courseRosters is
    only ever built for those same course ids (AppDataContext) — so `courses`/`exams`/
    `courseRosters` from useAppData() are already this teacher's data, filtered server-side.
    Cancelled-class notices with a reschedule action are handled by DashboardPage's shared notice
    banner rendered above this component, which already narrowly scopes that action to PUT
    /slot-exceptions/:id/reschedule (server re-checks canManageCourse) rather than the broad
    'timetable' write permission — this component covers the other half of "needs attention",
    the teacher's own unscheduled exams. */
export default function FacultyDashboard() {
  const { t } = useTranslation(['dashboard', 'academics', 'common']);
  const { courses, slots, exams, rooms, courseRosters } = useAppData();
  const { showSection } = useNavigation();
  const { openModal } = useModal();

  const myCourseIds = useMemo(() => new Set(courses.map(c => c.id)), [courses]);

  const myStudentCount = useMemo(() => new Set(
    [...courseRosters.values()].flat().filter(r => r.status === 'enrolled').map(r => r.studentId)
  ).size, [courseRosters]);

  const scheduledExams = exams.filter(e => e.date);
  const unscheduledExams = exams.filter(e => !e.date);

  const dayIdx = new Date().getDay();
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIdx];
  const todaySlots = slots
    .filter(s => s.day === day && myCourseIds.has(s.courseId))
    .slice()
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  return (
    <>
      <div className="dash-welcome-row">
        <div>
          <div className="dash-welcome-title">{t('dashboard.faculty.header.title')}</div>
          <div className="panel-subtitle">{t('dashboard.faculty.header.subtitle')}</div>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard icon="ti-book-2" hue="teal" label={t('dashboard.faculty.kpi.myCourses')} value={courses.length} />
        <StatCard
          icon="ti-users" hue="indigo"
          label={t('dashboard.faculty.kpi.myStudents')}
          value={myStudentCount}
          sub={t('dashboard.statCards.uniqueStudents')}
        />
        <StatCard
          icon="ti-writing" hue={unscheduledExams.length ? 'amber' : 'teal'}
          label={t('dashboard.faculty.kpi.myExams')}
          value={scheduledExams.length}
          sub={t('dashboard.statCards.unscheduledCount', { count: unscheduledExams.length })}
        />
      </div>

      <div className="panel-row dash-two-col">
        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.todayPanel.title', { day: t('common:days.' + day) })}</div>
                <div className="panel-subtitle">{t('dashboard.faculty.today.subtitle')}</div>
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
                  <div
                    className="exam-row" key={s.id}
                    style={{ borderInlineStart: `3px solid ${COLOR_HEX[courseColor(course.id)]}`, cursor: 'default' }}
                  >
                    <span className="pill pill-gray">{course.code}</span>
                    <div className="exam-name">{course.name}</div>
                    <div className="exam-meta">{fmt12Hour(s.time)}–{fmt12Hour(end)} · {roomName(rooms, s.roomId)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="dash-col">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{t('dashboard.faculty.attention.title')}</div>
                <div className="panel-subtitle">{t('dashboard.faculty.attention.subtitle')}</div>
              </div>
            </div>
            <div className="alert-list">
              {unscheduledExams.length === 0 && (
                <div className="field-hint" style={{ padding: 14 }}>{t('dashboard.faculty.attention.empty')}</div>
              )}
              {unscheduledExams.map(e => {
                const course = courseById(courses, e.courseId);
                return (
                  <div
                    className="alert-item alert-neutral" key={e.id} role="button" tabIndex={0}
                    onClick={() => openModal('exam', e.id)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openModal('exam', e.id); } }}
                  >
                    <i className="ti ti-calendar-exclamation" aria-hidden="true"></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">{course ? `${course.code} — ${course.name}` : t('dashboard.faculty.attention.unknownCourse')}</div>
                      <div className="alert-desc">{t(`academics:examForm.types.${e.type}`, e.type)}</div>
                    </div>
                    <i className="ti ti-chevron-right" aria-hidden="true"></i>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
