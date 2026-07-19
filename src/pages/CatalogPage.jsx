import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../api.js';
import { departmentName, teacherName } from '../utils.js';

export default function CatalogPage() {
  const { t } = useTranslation(['academics', 'common']);
  const { courses, departments, teachers, myEnrollments, terms, activeTermId, reload } = useAppData();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  const q = search.trim().toLowerCase();
  let filtered = deptFilter ? courses.filter(c => String(c.departmentId) === deptFilter) : courses;
  if (q) filtered = filtered.filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  const myStatusByCourse = new Map(myEnrollments.map(e => [e.id, e.status]));

  const activeTerm = terms.find(term => term.id === activeTermId);
  const currentTermCredits = myEnrollments
    .filter(e => e.status === 'enrolled' && e.termId === activeTermId)
    .reduce((sum, e) => sum + (e.credits || 0), 0);
  const overLimit = activeTerm?.creditLimit != null && currentTermCredits > activeTerm.creditLimit;

  async function registerForCourse(courseId) {
    try {
      const enrollment = await api('POST', '/enrollments', { courseId });
      toast(enrollment.status === 'waitlisted' ? t('academics:catalogPage.toasts.waitlisted') : t('academics:catalogPage.toasts.registered'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      await reload();
    }
  }

  return (
    <Section name="catalog">
      <div className="topbar">
        <i className="ti ti-book" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('academics:catalogPage.title')}</h2>
        <div className="topbar-actions">
          <input type="text" className="select-sm" aria-label={t('academics:catalogPage.searchAria')} placeholder={t('academics:catalogPage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          <select className="select-sm" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">{t('academics:catalogPage.allDepartments')}</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>
      <div id="content">
        {activeTerm && (
          <div className="panel-subtitle" style={{ marginBottom: 10 }}>
            <span className={'pill ' + (overLimit ? 'pill-red' : 'pill-gray')}>
              {activeTerm.creditLimit != null
                ? t('academics:catalogPage.creditsWithLimit', { current: currentTermCredits, limit: activeTerm.creditLimit })
                : t('academics:catalogPage.creditsNoLimit', { current: currentTermCredits })} — {activeTerm.name}
            </span>
          </div>
        )}
        <div className="panel">
          <table className="data-table">
            <thead><tr>
              <th>{t('academics:catalogPage.table.code')}</th>
              <th>{t('academics:catalogPage.table.courseName')}</th>
              <th>{t('academics:catalogPage.table.dept')}</th>
              <th>{t('academics:catalogPage.table.credits')}</th>
              <th>{t('academics:catalogPage.table.instructor')}</th>
              <th>{t('academics:catalogPage.table.capacity')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              {filtered.map(c => {
                const taken = myStatusByCourse.get(c.id);
                return (
                  <tr key={c.id}>
                    <td>{c.code}</td><td>{c.name}</td><td>{departmentName(departments, c.departmentId)}</td><td>{c.credits}</td>
                    <td>{teacherName(teachers, c.teacherId)}</td>
                    <td>{c.maxStudents != null ? c.maxStudents : '—'}</td>
                    <td>
                      {taken === 'enrolled' ? <span className="pill pill-green">{t('academics:catalogPage.enrolled')}</span>
                        : taken === 'waitlisted' ? <span className="pill pill-amber">{t('academics:catalogPage.waitlisted')}</span>
                        : <button className="btn-sm" onClick={() => registerForCourse(c.id)}>{t('academics:catalogPage.register')}</button>}
                    </td>
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
