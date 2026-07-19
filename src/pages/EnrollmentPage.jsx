import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { courseById, teacherName, enrolledCount, waitlistCount } from '../utils.js';

export default function EnrollmentPage() {
  const { t } = useTranslation(['academics', 'common']);
  const { courses, teachers, courseRosters, reload } = useAppData();
  const { openModal } = useModal();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('course');

  const q = search.trim().toLowerCase();
  const filteredCourses = q ? courses.filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : courses;

  const studentMap = new Map();
  courseRosters.forEach((roster, courseId) => {
    roster.forEach(r => {
      if (!studentMap.has(r.studentId)) studentMap.set(r.studentId, { name: r.name, idNumber: r.idNumber, courses: [] });
      studentMap.get(r.studentId).courses.push({ course: courseById(courses, courseId), status: r.status });
    });
  });
  let studentList = [...studentMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (q) studentList = studentList.filter(s => s.name.toLowerCase().includes(q) || (s.idNumber || '').toLowerCase().includes(q));

  return (
    <Section name="enrollment">
      <div className="topbar">
        <i className="ti ti-users" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('academics:enrollmentPage.title')}</h2>
        <div className="topbar-actions">
          <input type="text" className="select-sm" aria-label={t('academics:enrollmentPage.searchAria')} placeholder={t('academics:enrollmentPage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn-sm" onClick={reload}><i className="ti ti-refresh"></i> {t('academics:enrollmentPage.refresh')}</button>
        </div>
      </div>
      <div id="content">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">{t('academics:enrollmentPage.overviewTitle')}</div>
            <div className="tabs">
              <button className={'tab' + (tab === 'course' ? ' active' : '')} onClick={() => setTab('course')}>{t('academics:enrollmentPage.tabs.byCourse')}</button>
              <button className={'tab' + (tab === 'student' ? ' active' : '')} onClick={() => setTab('student')}>{t('academics:enrollmentPage.tabs.byStudent')}</button>
            </div>
          </div>
          <table className="data-table" style={{ display: tab === 'course' ? '' : 'none' }}>
            <thead><tr>
              <th>{t('academics:enrollmentPage.courseTable.course')}</th>
              <th>{t('academics:enrollmentPage.courseTable.instructor')}</th>
              <th>{t('academics:enrollmentPage.courseTable.capacity')}</th>
              <th>{t('academics:enrollmentPage.courseTable.enrolled')}</th>
              <th>{t('academics:enrollmentPage.courseTable.fillRate')}</th>
              <th>{t('academics:enrollmentPage.courseTable.waitlist')}</th>
            </tr></thead>
            <tbody>
              {filteredCourses.map(c => {
                const enrolled = enrolledCount(courseRosters, c.id);
                const waitlisted = waitlistCount(courseRosters, c.id);
                const pct = c.maxStudents ? Math.round((enrolled / c.maxStudents) * 100) : 0;
                const over = c.maxStudents != null && enrolled > c.maxStudents;
                return (
                  <tr key={c.id} onClick={() => openModal('roster', c.id)}>
                    <td><span className={'pill ' + (over ? 'pill-red' : 'pill-blue')} style={{ marginInlineEnd: 6 }}>{c.code}</span>{c.name}</td>
                    <td>{teacherName(teachers, c.teacherId)}</td><td>{c.maxStudents ?? '—'}</td><td>{enrolled}</td>
                    <td>
                      <div style={{ color: over ? 'var(--danger)' : 'inherit' }}>{pct}%</div>
                      <div className="cap-bar"><div className="cap-fill" style={{ width: `${Math.min(pct, 100)}%`, background: over ? 'var(--danger)' : 'var(--success)' }}></div></div>
                    </td>
                    <td>{waitlisted}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <table className="data-table" style={{ display: tab === 'student' ? '' : 'none' }}>
            <thead><tr>
              <th>{t('academics:enrollmentPage.studentTable.studentId')}</th>
              <th>{t('academics:enrollmentPage.studentTable.student')}</th>
              <th>{t('academics:enrollmentPage.studentTable.courses')}</th>
              <th>{t('academics:enrollmentPage.studentTable.totalCredits')}</th>
            </tr></thead>
            <tbody>
              {studentList.map((s, i) => {
                const credits = s.courses.filter(c => c.status === 'enrolled').reduce((sum, c) => sum + (c.course?.credits || 0), 0);
                return (
                  <tr key={i}>
                    <td><code>{s.idNumber || '—'}</code></td>
                    <td>{s.name}</td>
                    <td>{s.courses.length
                      ? s.courses.map((c, j) => (
                        <span className={'pill ' + (c.status === 'waitlisted' ? 'pill-amber' : 'pill-blue')} style={{ marginInlineEnd: 4 }} key={j}>
                          {c.status === 'waitlisted'
                            ? t('academics:enrollmentPage.studentTable.waitlistedCode', { code: c.course?.code })
                            : c.course?.code}
                        </span>
                      ))
                      : <span className="pill pill-gray">{t('academics:enrollmentPage.studentTable.none')}</span>}</td>
                    <td>{credits}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
