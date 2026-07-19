import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import WeeklyCalendar from '../components/WeeklyCalendar.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { withdrawFromCourse } from '../api.js';
import { DAYS, courseById, roomName, termName, icsEscape, nextDateForDay, downloadFile, mondayOf, weekDatesFrom } from '../utils.js';

export default function MySchedulePage() {
  const { t } = useTranslation(['academics', 'common']);
  const { slots, courses, rooms, terms, activeTermId, myEnrollments, afterMutate, slotExceptions, branding, unviewedActivityCourseIds, myFinalGrades } = useAppData();
  const { openModal } = useModal();
  const { toast } = useToast();
  const [dayFilter, setDayFilter] = useState('');

  const enrolledCourseIds = new Set(myEnrollments.filter(e => e.status === 'enrolled').map(e => e.id));
  const mySlots = slots.filter(s => enrolledCourseIds.has(s.courseId));

  const activeTerm = terms.find(term => term.id === activeTermId);
  const currentTermCredits = myEnrollments
    .filter(e => e.status === 'enrolled' && e.termId === activeTermId)
    .reduce((sum, e) => sum + (e.credits || 0), 0);
  const overLimit = activeTerm?.creditLimit != null && currentTermCredits > activeTerm.creditLimit;

  /** Final grade is auto-computed (see api's gradingScale.js) — only appears once every grade
      item for that course has a score; until then this shows "In progress" rather than a bare
      dash, so a partially-graded course reads differently from a not-yet-graded one. */
  function renderGradeCell(courseId) {
    const g = myFinalGrades.get(courseId);
    if (g?.letterGrade) return <span className="pill pill-blue">{g.letterGrade}</span>;
    if (g?.hasAnyScore) return <span className="pill pill-gray">{t('academics:mySchedulePage.gradeInProgress')}</span>;
    return '—';
  }

  function exportMyScheduleIcs() {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${icsEscape(branding.orgName || 'UniScheduler')}//EN`];
    mySlots.forEach(s => {
      const course = courseById(courses, s.courseId);
      if (!course) return;
      const startDate = nextDateForDay(s.day);
      const [h, m] = String(s.time).split(':').map(Number);
      const startMin = h * 60 + m;
      const endMin = startMin + (s.durationMinutes || 60);
      const fmtT = (mins) => String(Math.floor(mins / 60) % 24).padStart(2, '0') + String(mins % 60).padStart(2, '0') + '00';
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:slot-${s.id}@unischeduler`);
      lines.push(`DTSTART:${startDate}T${fmtT(startMin)}`);
      lines.push(`DTEND:${startDate}T${fmtT(endMin)}`);
      lines.push('RRULE:FREQ=WEEKLY;COUNT=15');
      lines.push(`SUMMARY:${icsEscape(course.code + ' ' + course.name)}`);
      lines.push(`LOCATION:${icsEscape(roomName(rooms, s.roomId))}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    downloadFile('my-schedule.ics', lines.join('\r\n'), 'text/calendar');
    toast(t('academics:mySchedulePage.calendarExported'));
  }

  return (
    <Section name="myschedule">
      <div className="topbar">
        <i className="ti ti-calendar-week" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('academics:mySchedulePage.title')}</h2>
        <div className="topbar-actions">
          <select className="select-sm" value={dayFilter} onChange={e => setDayFilter(e.target.value)}>
            <option value="">{t('academics:mySchedulePage.allDays')}</option>
            {DAYS.map(d => <option key={d} value={d}>{t('common:days.' + d)}</option>)}
          </select>
          <button className="btn-sm" onClick={exportMyScheduleIcs}><i className="ti ti-download"></i> {t('academics:mySchedulePage.exportCalendar')}</button>
        </div>
      </div>
      <div id="content">
        {/* Current-week dates so students see this week's cancellations/moves on their own schedule. */}
        <WeeklyCalendar slotsToShow={mySlots} editable={false} addable={false} dayFilter={dayFilter}
          weekDates={weekDatesFrom(mondayOf(new Date()))} exceptions={slotExceptions}
          onCardClick={(course) => openModal('course-activity', course.id)}
          unviewedCourseIds={unviewedActivityCourseIds} finalGradesByCourseId={myFinalGrades} />
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('academics:mySchedulePage.myCoursesTitle')}</div>
              <div className="panel-subtitle">{t('academics:mySchedulePage.myCoursesHint')}</div>
            </div>
            {activeTerm && (
              <span className={'pill ' + (overLimit ? 'pill-red' : 'pill-gray')}>
                {activeTerm.creditLimit != null
                  ? t('academics:mySchedulePage.creditsWithLimit', { current: currentTermCredits, limit: activeTerm.creditLimit })
                  : t('academics:mySchedulePage.creditsNoLimit', { current: currentTermCredits })} — {activeTerm.name}
              </span>
            )}
          </div>
          <table className="data-table">
            <thead><tr>
              <th>{t('academics:mySchedulePage.table.code')}</th>
              <th>{t('academics:mySchedulePage.table.courseName')}</th>
              <th>{t('academics:mySchedulePage.table.semester')}</th>
              <th>{t('academics:mySchedulePage.table.credits')}</th>
              <th>{t('academics:mySchedulePage.table.status')}</th>
              <th>{t('academics:mySchedulePage.table.grade')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              {myEnrollments.length ? myEnrollments.map(e => (
                <tr key={e.enrollmentId}>
                  <td>{e.code}</td><td>{e.name}</td>
                  <td>
                    {termName(terms, e.termId)}
                    {e.termId !== activeTermId && <span className="pill pill-gray" style={{ marginInlineStart: 4 }}>{t('academics:mySchedulePage.otherTerm')}</span>}
                  </td>
                  <td>{e.credits}</td>
                  <td><span className={'pill ' + (e.status === 'waitlisted' ? 'pill-amber' : 'pill-green')}>{e.status === 'waitlisted' ? t('academics:mySchedulePage.waitlisted') : t('academics:mySchedulePage.enrolled')}</span></td>
                  <td>{renderGradeCell(e.id)}</td>
                  <td>
                    <button className="icon-btn danger" aria-label={t('academics:mySchedulePage.withdrawAriaLabel', { code: e.code })} onClick={() => afterMutate(withdrawFromCourse(e.enrollmentId), t('academics:mySchedulePage.withdrawn'))}>
                      <i className="ti ti-x" aria-hidden="true"></i>
                    </button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="field-hint" style={{ padding: 14 }}>{t('academics:mySchedulePage.emptyState')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
