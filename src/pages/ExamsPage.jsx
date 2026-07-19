import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import {
  courseById, roomName, teacherName, fmtDate, fmt12Hour, withinNextDays, examStatus, enrolledCount,
  courseColor, courseProgramSemester, courseSession, weekdayOfDate, EXAM_TYPES,
} from '../utils.js';

export default function ExamsPage() {
  const { t } = useTranslation(['academics', 'common']);
  const { currentUser, exams, courses, rooms, teachers, slots, conflictsData, courseRosters } = useAppData();
  const { openModal } = useModal();
  const [tabFilter, setTabFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [semesterFilter, setSemesterFilter] = useState('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [autoGenResult, setAutoGenResult] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  const isAdmin = currentUser.role === 'admin';
  const semesterOptions = [...new Set(slots.map(s => s.programSemester).filter(v => v != null))].sort((a, b) => a - b);

  const scheduled = exams.filter(e => e.date).length;
  const unscheduled = exams.length - scheduled;
  const clashStudentIds = new Set(conflictsData.warnings.filter(w => w.type === 'exam-clash').flatMap(w => w.studentIds));
  const capacityIssues = conflictsData.warnings.filter(w => w.type === 'capacity').length;

  let list = exams;
  if (tabFilter === 'week') list = exams.filter(e => withinNextDays(e.date, 7));
  else if (tabFilter === 'issues') list = exams.filter(e => examStatus(e, conflictsData).key !== 'confirmed');
  if (typeFilter !== 'all') list = list.filter(e => (e.type || 'final') === typeFilter);
  if (semesterFilter !== 'all') list = list.filter(e => courseProgramSemester(slots, e.courseId) === Number(semesterFilter));
  if (sessionFilter !== 'all') list = list.filter(e => courseSession(slots, e.courseId) === sessionFilter);

  // Scheduled exams soonest-first, unscheduled ones pushed to the end (grouped together,
  // alphabetical by course) — no click-to-sort headers now that this is a card grid.
  const sorted = [...list].sort((a, b) => {
    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    if (a.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.date && a.time !== b.time) return (a.time || '') < (b.time || '') ? -1 : 1;
    const an = courseById(courses, a.courseId)?.name || '';
    const bn = courseById(courses, b.courseId)?.name || '';
    return an.localeCompare(bn);
  });

  // Exams span the whole exam period (weeks), not one week like the regular Timetable, so a
  // fixed-column grid doesn't fit — instead group into one section per date (chronological, same
  // order as `sorted` above), each independently collapsible so 100+ exams stays scannable.
  const groups = [];
  for (const e of sorted) {
    const key = e.date || '__unscheduled__';
    if (groups.length === 0 || groups[groups.length - 1].key !== key) groups.push({ key, date: e.date || null, items: [] });
    groups[groups.length - 1].items.push(e);
  }

  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <Section name="exams">
      <div className="topbar">
        <i className="ti ti-writing" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('academics:examsPage.title')}</h2>
        <div className="topbar-actions">
          <div className="tabs">
            <button className={'tab' + (tabFilter === 'all' ? ' active' : '')} onClick={() => setTabFilter('all')}>{t('academics:examsPage.tabs.all')}</button>
            <button className={'tab' + (tabFilter === 'week' ? ' active' : '')} onClick={() => setTabFilter('week')}>{t('academics:examsPage.tabs.week')}</button>
            <button className={'tab' + (tabFilter === 'issues' ? ' active' : '')} onClick={() => setTabFilter('issues')}>{t('academics:examsPage.tabs.issues')}</button>
          </div>
          <select className="select-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label={t('academics:examsPage.typeFilter.aria')}>
            <option value="all">{t('academics:examsPage.typeFilter.all')}</option>
            {EXAM_TYPES.map(v => <option key={v} value={v}>{t(`academics:examForm.types.${v}`)}</option>)}
          </select>
          <select className="select-sm" value={semesterFilter} onChange={e => setSemesterFilter(e.target.value)} aria-label={t('academics:examsPage.semesterFilter.aria')}>
            <option value="all">{t('academics:examsPage.semesterFilter.all')}</option>
            {semesterOptions.map(n => <option key={n} value={n}>{t('academics:examsPage.semBadge', { n })}</option>)}
          </select>
          <select className="select-sm" value={sessionFilter} onChange={e => setSessionFilter(e.target.value)} aria-label={t('academics:examsPage.sessionFilter.aria')}>
            <option value="all">{t('academics:examsPage.sessionFilter.all')}</option>
            <option value="Morning">{t('academics:examsPage.session.morning')}</option>
            <option value="Evening">{t('academics:examsPage.session.evening')}</option>
          </select>
          {isAdmin && <button className="btn-primary" onClick={() => openModal('exam')}><i className="ti ti-plus"></i> {t('academics:examsPage.scheduleExam')}</button>}
          {isAdmin && (
            <button className="btn-gold" onClick={() => openModal('auto-generate-exam-type', null, { onComplete: setAutoGenResult })}>
              <i className="ti ti-wand"></i> {t('academics:examsPage.autoGenerate')}
            </button>
          )}
        </div>
      </div>
      <div id="content">
        <div className="stat-grid">
          <div className="stat-card stat-accent-green">
            <div className="s-icon s-green"><i className="ti ti-check"></i></div>
            <div className="stat-label">{t('academics:examsPage.stats.scheduled.label')}</div>
            <div className="stat-value">{scheduled}</div>
            <div className="stat-sub ok">{t('academics:examsPage.stats.scheduled.sub', { count: exams.length })}</div>
          </div>
          <div className="stat-card stat-accent-gold">
            <div className="s-icon s-gold"><i className="ti ti-clock"></i></div>
            <div className="stat-label">{t('academics:examsPage.stats.unscheduled.label')}</div>
            <div className="stat-value">{unscheduled}</div>
            <div className="stat-sub warn">{t('academics:examsPage.stats.unscheduled.sub')}</div>
          </div>
          <div className="stat-card stat-accent-red">
            <div className="s-icon s-red"><i className="ti ti-user-exclamation"></i></div>
            <div className="stat-label">{t('academics:examsPage.stats.studentClashes.label')}</div>
            <div className="stat-value">{clashStudentIds.size}</div>
            <div className="stat-sub bad">{t('academics:examsPage.stats.studentClashes.sub', { count: conflictsData.warnings.filter(w => w.type === 'exam-clash').length })}</div>
          </div>
          <div className="stat-card stat-accent-red">
            <div className="s-icon s-red"><i className="ti ti-building"></i></div>
            <div className="stat-label">{t('academics:examsPage.stats.capacityIssues.label')}</div>
            <div className="stat-value">{capacityIssues}</div>
            <div className="stat-sub bad">{t('academics:examsPage.stats.capacityIssues.sub')}</div>
          </div>
        </div>
        {autoGenResult && (
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-header">
              <div className="panel-title">{t('academics:examsPage.autoGenResult.title')}</div>
              <button className="btn-sm" onClick={() => setAutoGenResult(null)}>{t('academics:examsPage.autoGenResult.dismiss')}</button>
            </div>
            <div className="field-hint" style={{ padding: '0 14px 12px' }}>
              {t('academics:examsPage.autoGenResult.summary', {
                created: autoGenResult.created, scheduled: autoGenResult.scheduled,
                type: autoGenResult.examType ? t(`academics:examForm.types.${autoGenResult.examType}`) : '',
              })}
            </div>
            {(autoGenResult.unresolved?.length > 0 || autoGenResult.needsInvigilator?.length > 0) && (
              <div className="alert-list">
                {autoGenResult.unresolved.map(u => (
                  <div key={'u' + u.examId} className="alert-item alert-warn">
                    <i className="ti ti-alert-triangle" style={{ fontSize: 18 }}></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">{u.courseName || u.courseCode || `#${u.courseId}`}</div>
                      <div className="alert-desc">{u.reason}</div>
                    </div>
                  </div>
                ))}
                {autoGenResult.needsInvigilator?.map(u => (
                  <div key={'i' + u.examId} className="alert-item alert-warn">
                    <i className="ti ti-user-exclamation" style={{ fontSize: 18 }}></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">{u.courseName || u.courseCode || `#${u.courseId}`}</div>
                      <div className="alert-desc">{t('academics:examsPage.autoGenResult.needsInvigilator')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">{t('academics:examsPage.table.heading')}</div>
            {groups.length > 1 && (
              <div className="panel-header-actions">
                <button className="btn-sm" onClick={() => setCollapsedGroups(new Set(groups.map(g => g.key)))}>{t('academics:examsPage.dateGroups.collapseAll')}</button>
                <button className="btn-sm" onClick={() => setCollapsedGroups(new Set())}>{t('academics:examsPage.dateGroups.expandAll')}</button>
              </div>
            )}
          </div>
          {sorted.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('academics:examsPage.card.empty')}</div>}
          <div className="exam-date-groups">
            {groups.map(g => {
              const isUnscheduled = !g.date;
              const isCollapsed = collapsedGroups.has(g.key);
              return (
                <div key={g.key} className="exam-date-group">
                  <button
                    type="button"
                    className={'exam-date-header' + (isUnscheduled ? ' exam-date-header-unscheduled' : '')}
                    onClick={() => toggleGroup(g.key)}
                    aria-expanded={!isCollapsed}
                  >
                    <i className={'ti ' + (isCollapsed ? 'ti-chevron-right' : 'ti-chevron-down')} aria-hidden="true"></i>
                    <span className="exam-date-header-label">
                      {isUnscheduled ? t('academics:examsPage.dateGroups.unscheduled') : `${t('common:days.' + weekdayOfDate(g.date))}, ${fmtDate(g.date)}`}
                    </span>
                    <span className="exam-date-header-count">{t('academics:examsPage.dateGroups.count', { count: g.items.length })}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="exam-card-grid">
                      {g.items.map(e => {
                        const course = courseById(courses, e.courseId);
                        const status = examStatus(e, conflictsData);
                        const examType = e.type || 'final';
                        const programSemester = courseProgramSemester(slots, e.courseId);
                        const session = courseSession(slots, e.courseId);
                        return (
                          <div
                            key={e.id}
                            className={`slot slot-course-${courseColor(e.courseId)}`}
                            onClick={() => openModal('exam', e.id)}
                            title={course?.name || ''}
                          >
                            <div className="exam-card-head">
                              <div className="slot-name">{course?.name || '—'}</div>
                              <span className={`exam-type-badge exam-type-${examType}`}>{t(`academics:examForm.types.${examType}`)}</span>
                            </div>
                            {(programSemester != null || session) && (
                              <div className="exam-card-badges">
                                {programSemester != null && <span className="slot-sem-badge">{t('academics:examsPage.semBadge', { n: programSemester })}</span>}
                                {session && <span className="slot-session-badge">{t(`academics:examsPage.session.${session.toLowerCase()}`)}</span>}
                              </div>
                            )}
                            <div className="slot-meta">
                              <div className="slot-meta-row slot-time">
                                <i className="ti ti-calendar" aria-hidden="true"></i>
                                {e.date ? `${fmtDate(e.date)} · ${fmt12Hour(e.time)}` : t('academics:examsPage.card.notScheduled')}
                              </div>
                              <div className="slot-meta-row"><i className="ti ti-map-pin" aria-hidden="true"></i>{e.roomId ? roomName(rooms, e.roomId) : '—'}</div>
                              <div className="slot-meta-row"><i className="ti ti-user-check" aria-hidden="true"></i>{e.invigilatorId ? t('academics:examsPage.card.invigilator', { name: teacherName(teachers, e.invigilatorId) }) : '—'}</div>
                              <div className="slot-meta-row"><i className="ti ti-users" aria-hidden="true"></i>{t('academics:examsPage.card.students', { count: enrolledCount(courseRosters, e.courseId) })}</div>
                            </div>
                            <span className={'pill ' + status.cls}>{t(`common:status.${status.key}`)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}
