import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { Card } from './ui/Card.jsx';
import {
  COLOR_HEX, courseColor, courseById, roomName, teacherName,
  timeToMinutes, addMinutes, fmt12Hour, fmtDate, examStatus, enrolledCount,
} from '../utils.js';

// How many stat rows the carousel shows at once, and each row's height in px — must match
// .stat-carousel-row's height in style.css, since the scroll offset is index * ROW_HEIGHT.
const VISIBLE_STAT_ROWS = 3;
const ROW_HEIGHT = 60;
// How long each stat holds in view before stepping to the next one, in ms.
const STEP_INTERVAL = 4000;

/** A single compact card holding every top-line dashboard stat, stacked vertically. Renders
    statically (no motion at all) as long as every stat fits within VISIBLE_STAT_ROWS — today
    there are exactly 3 stats and 3 visible rows, so nothing scrolls yet. The step-and-pause
    carousel activates automatically the moment a 4th stat is ever added to the `stats` array,
    with no further changes needed here. */
function StatCarouselCard({ stats }) {
  const [index, setIndex] = useState(0);
  const [instant, setInstant] = useState(false);
  const loops = stats.length > VISIBLE_STAT_ROWS;

  // The classic seamless-loop trick: append a copy of the first VISIBLE_STAT_ROWS stats after
  // the real list, so the track can keep scrolling in one direction past the "last" real row
  // into what looks like the first rows again, then snap back to index 0 with no transition —
  // the duplicate rows make that snap invisible.
  const trackStats = loops ? [...stats, ...stats.slice(0, VISIBLE_STAT_ROWS)] : stats;

  useEffect(() => {
    if (!loops) return;
    const id = setInterval(() => setIndex(i => i + 1), STEP_INTERVAL);
    return () => clearInterval(id);
  }, [loops]);

  useEffect(() => {
    if (!loops || index !== stats.length) return;
    // Reached the duplicated tail — once the slide finishes, snap back to the real start
    // with no transition so the loop reads as continuous rather than rewinding visibly.
    const id = setTimeout(() => { setInstant(true); setIndex(0); }, 500);
    return () => clearTimeout(id);
  }, [index, loops, stats.length]);

  useEffect(() => {
    if (!instant) return;
    const id = requestAnimationFrame(() => setInstant(false));
    return () => cancelAnimationFrame(id);
  }, [instant]);

  return (
    <Card className="stat-carousel-card">
      <div className="stat-carousel-viewport" style={{ height: VISIBLE_STAT_ROWS * ROW_HEIGHT }}>
        <div
          className="stat-carousel-track"
          style={{ transform: `translateY(-${index * ROW_HEIGHT}px)`, transition: instant ? 'none' : undefined }}
        >
          {trackStats.map((s, i) => (
            <div className="stat-carousel-row" key={`${s.key}-${i}`}>
              <div className={`stat-carousel-icon-wrap ${s.color}`}><i className={s.icon} aria-hidden="true"></i></div>
              <div className="stat-carousel-info">
                <div className="stat-carousel-label">{s.label}</div>
                <div className="stat-carousel-value-line">
                  <span className="stat-carousel-value">{s.value}</span>
                  <span className={`stat-carousel-subnote ${s.color}`}>{s.subNote}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** The default landing dashboard for any staff role with no dedicated variant of its own
    (Faculty, Exam Officer, etc. — see the ROLE_DASHBOARDS map in DashboardPage.jsx): scheduling
    stat cards, today's timetable, and upcoming exams. Every other role-specific dashboard
    (SuperAdmin/Student/Registrar/Bursar) replaces this entirely rather than extending it. */
export default function GenericStaffDashboard() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { currentUser, courses, slots, exams, rooms, teachers, conflictsData, courseRosters } = useAppData();
  const { showSection } = useNavigation();
  const { openModal } = useModal();

  const uniqueEnrolled = new Set([...courseRosters.values()].flat().filter(r => r.status === 'enrolled').map(r => r.studentId));

  const dayIdx = new Date().getDay();
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIdx];
  const todaySlots = slots.filter(s => s.day === day).slice().sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  const upcoming = exams.filter(e => e.date).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 5);

  return (
    <>
      <StatCarouselCard stats={[
        {
          key: 'courses', color: 'teal', icon: 'ti ti-book-2',
          label: currentUser.role === 'faculty' ? t('dashboard.statCards.myCourses') : t('dashboard.statCards.totalCourses'),
          value: courses.length, subNote: t('dashboard.statCards.liveCount'),
        },
        {
          key: 'students', color: 'green', icon: 'ti ti-users',
          label: t('dashboard.statCards.enrolledStudents'),
          value: uniqueEnrolled.size, subNote: t('dashboard.statCards.uniqueStudents'),
        },
        {
          key: 'exams', color: 'amber', icon: 'ti ti-writing',
          label: t('dashboard.statCards.scheduledExams'),
          value: exams.filter(e => e.date).length,
          subNote: t('dashboard.statCards.unscheduledCount', { count: exams.filter(e => !e.date).length }),
        },
      ]} />

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
    </>
  );
}
