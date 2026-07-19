import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useTableSort } from '../hooks/useTableSort.jsx';
import { deleteTeacher } from '../api.js';
import { departmentName } from '../utils.js';

export default function TeachersPage() {
  const { t } = useTranslation(['management', 'common']);
  const { teachers, departments, courses, slots, allUsers, afterMutate } = useAppData();
  const { openModal, confirmAction } = useModal();
  const [search, setSearch] = useState('');

  // A teacher's Faculty ID belongs to their linked login account (users.idNumber) — a
  // teacher record can exist without one (added before ever getting a login), in which
  // case there's simply no ID yet.
  const facultyIdOf = (t) => (t.userId != null ? allUsers.find(u => u.id === t.userId)?.idNumber : null) || null;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? teachers.filter(t => t.name.toLowerCase().includes(q) || (facultyIdOf(t) || '').toLowerCase().includes(q))
    : teachers;
  const { sorted, sortTh, sortArrow } = useTableSort('teachers', filtered, {
    facultyId: t => facultyIdOf(t) || '',
    name: t => t.name,
    dept: t => departmentName(departments, t.departmentId),
    courses: t => courses.filter(c => c.teacherId === t.id).length,
    sessions: t => slots.filter(s => courses.some(c => c.teacherId === t.id && c.id === s.courseId)).length,
  });

  return (
    <Section name="teachers">
      <div className="topbar">
        <i className="ti ti-user" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('management:teachersPage.title')}</h2>
        <div className="topbar-actions">
          <input type="text" className="select-sm" aria-label={t('management:teachersPage.searchAriaLabel')} placeholder={t('management:teachersPage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn-primary" onClick={() => openModal('teacher')}><i className="ti ti-plus"></i> {t('management:teachersPage.addTeacher')}</button>
        </div>
      </div>
      <div id="content">
        <div className="panel">
          <table className="data-table">
            <thead><tr>
              <th {...sortTh('facultyId')}>{t('management:teachersPage.columns.facultyId')}{sortArrow('facultyId')}</th>
              <th {...sortTh('name')}>{t('common:fields.name')}{sortArrow('name')}</th>
              <th {...sortTh('dept')}>{t('common:fields.department')}{sortArrow('dept')}</th>
              <th {...sortTh('courses')}>{t('management:teachersPage.columns.courses')}{sortArrow('courses')}</th>
              <th {...sortTh('sessions')}>{t('management:teachersPage.columns.sessions')}{sortArrow('sessions')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              {sorted.map(t3 => {
                const taught = courses.filter(c => c.teacherId === t3.id);
                const sessions = slots.filter(s => taught.some(c => c.id === s.courseId)).length;
                return (
                  <tr key={t3.id} onClick={() => openModal('teacher', t3.id)}>
                    <td><code>{facultyIdOf(t3) || '—'}</code></td>
                    <td>{t3.name}</td><td>{departmentName(departments, t3.departmentId)}</td>
                    <td>{taught.length
                      ? taught.map(c => <span className="pill pill-blue" style={{ marginInlineEnd: 4 }} key={c.id}>{c.code}</span>)
                      : <span className="pill pill-gray">{t('management:teachersPage.noCourses')}</span>}</td>
                    <td>{sessions}</td>
                    <td><div className="row-actions">
                      <button className="icon-btn danger" aria-label={t('management:teachersPage.deleteAria', { name: t3.name })} onClick={e => { e.stopPropagation(); confirmAction(t('management:teachersPage.confirmDelete', { name: t3.name }), () => afterMutate(deleteTeacher(t3.id), t('management:teachersPage.toastRemoved'))); }}><i className="ti ti-trash" aria-hidden="true"></i></button>
                    </div></td>
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
