import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useTableSort } from '../hooks/useTableSort.jsx';
import { deleteTeacher } from '../api.js';
import { departmentName } from '../utils.js';

const DESIGNATIONS = [
  'Lecturer', 'Senior Lecturer', 'Instructor', 'Assistant Professor', 'Associate Professor', 'Professor',
  'Teaching Assistant', 'Research Assistant', 'Visiting Professor', 'Visiting Faculty', 'Adjunct Faculty', 'Other',
];
const EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'visiting', 'adjunct'];
const PROFILE_STATUSES = ['Complete', 'Under Review', 'Incomplete', 'Documents Pending'];
const PROFILE_STATUS_PILL = {
  Complete: 'pill-green', 'Under Review': 'pill-blue', Incomplete: 'pill-amber', 'Documents Pending': 'pill-amber',
};

export default function TeachersPage() {
  const { t } = useTranslation(['management', 'teacherProfile', 'common']);
  const { teachers, teacherProfileSummaries, departments, courses, slots, allUsers, afterMutate } = useAppData();
  const { openModal, confirmAction } = useModal();
  const { showSection } = useNavigation();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [rankFilter, setRankFilter] = useState('');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('');
  const [profileStatusFilter, setProfileStatusFilter] = useState('');

  // A teacher's Faculty ID belongs to their linked login account (users.idNumber) — a
  // teacher record can exist without one (added before ever getting a login), in which
  // case there's simply no ID yet.
  const facultyIdOf = (t2) => (t2.userId != null ? allUsers.find(u => u.id === t2.userId)?.idNumber : null) || null;
  const summaryOf = (t2) => teacherProfileSummaries.get(t2.id) || null;

  const q = search.trim().toLowerCase();
  const filtered = teachers.filter(t2 => {
    if (q) {
      const summary = summaryOf(t2);
      const haystack = [t2.name, facultyIdOf(t2), summary?.employeeId].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (deptFilter && String(t2.departmentId) !== deptFilter) return false;
    const summary = summaryOf(t2);
    if (rankFilter && summary?.designation !== rankFilter) return false;
    if (employmentTypeFilter && summary?.employmentType !== employmentTypeFilter) return false;
    if (profileStatusFilter && summary?.profileStatus !== profileStatusFilter) return false;
    return true;
  });
  const { sorted, sortTh, sortArrow } = useTableSort('teachers', filtered, {
    employeeId: t2 => summaryOf(t2)?.employeeId || '',
    name: t2 => t2.name,
    rank: t2 => summaryOf(t2)?.designation || '',
    dept: t2 => departmentName(departments, t2.departmentId),
    courses: t2 => courses.filter(c => c.teacherId === t2.id).length,
    sessions: t2 => slots.filter(s => courses.some(c => c.teacherId === t2.id && c.id === s.courseId)).length,
    completion: t2 => summaryOf(t2)?.completionPercent ?? 0,
  });

  return (
    <Section name="teachers">
      <div className="topbar">
        <i className="ti ti-user" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('management:teachersPage.title')}</h2>
        <div className="topbar-actions">
          <input type="text" className="select-sm" aria-label={t('management:teachersPage.searchAriaLabel')} placeholder={t('management:teachersPage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          <select className="select-sm" value={deptFilter} onChange={e => setDeptFilter(e.target.value)} aria-label={t('common:fields.department')}>
            <option value="">{t('management:teachersPage.filters.allDepartments')}</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="select-sm" value={rankFilter} onChange={e => setRankFilter(e.target.value)} aria-label={t('management:teachersPage.filters.allRanks')}>
            <option value="">{t('management:teachersPage.filters.allRanks')}</option>
            {DESIGNATIONS.map(d => <option key={d} value={d}>{t(`teacherProfile:designationOptions.${d}`)}</option>)}
          </select>
          <select className="select-sm" value={employmentTypeFilter} onChange={e => setEmploymentTypeFilter(e.target.value)} aria-label={t('management:teachersPage.filters.allEmploymentTypes')}>
            <option value="">{t('management:teachersPage.filters.allEmploymentTypes')}</option>
            {EMPLOYMENT_TYPES.map(v => <option key={v} value={v}>{t(`teacherProfile:employmentTypeOptions.${v}`)}</option>)}
          </select>
          <select className="select-sm" value={profileStatusFilter} onChange={e => setProfileStatusFilter(e.target.value)} aria-label={t('management:teachersPage.filters.allProfileStatuses')}>
            <option value="">{t('management:teachersPage.filters.allProfileStatuses')}</option>
            {PROFILE_STATUSES.map(s => <option key={s} value={s}>{t(`teacherProfile:profileStatus.${s}`)}</option>)}
          </select>
          <button className="btn-primary" onClick={() => showSection('faculty-onboarding')}><i className="ti ti-plus"></i> {t('management:teachersPage.addTeacher')}</button>
        </div>
      </div>
      <div id="content">
        <div className="panel">
          <table className="data-table">
            <thead><tr>
              <th {...sortTh('employeeId')}>{t('management:teachersPage.columns.facultyId')}{sortArrow('employeeId')}</th>
              <th {...sortTh('name')}>{t('common:fields.name')}{sortArrow('name')}</th>
              <th {...sortTh('rank')}>{t('management:teachersPage.columns.rank')}{sortArrow('rank')}</th>
              <th {...sortTh('dept')}>{t('common:fields.department')}{sortArrow('dept')}</th>
              <th {...sortTh('courses')}>{t('management:teachersPage.columns.courses')}{sortArrow('courses')}</th>
              <th {...sortTh('sessions')}>{t('management:teachersPage.columns.sessions')}{sortArrow('sessions')}</th>
              <th {...sortTh('completion')}>{t('management:teachersPage.columns.completion')}{sortArrow('completion')}</th>
              <th>{t('management:teachersPage.columns.status')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              {sorted.map(t3 => {
                const taught = courses.filter(c => c.teacherId === t3.id);
                const sessions = slots.filter(s => taught.some(c => c.id === s.courseId)).length;
                const summary = summaryOf(t3);
                return (
                  <tr key={t3.id} onClick={() => openModal('teacher', t3.id)}>
                    <td><code>{summary?.employeeId || facultyIdOf(t3) || '—'}</code></td>
                    <td>{t3.name}</td>
                    <td>{summary?.designation ? t(`teacherProfile:designationOptions.${summary.designation}`, summary.designation) : <span className="field-hint">{t('common:notApplicable')}</span>}</td>
                    <td>{departmentName(departments, t3.departmentId)}</td>
                    <td>{taught.length
                      ? taught.map(c => <span className="pill pill-blue" style={{ marginInlineEnd: 4 }} key={c.id}>{c.code}</span>)
                      : <span className="pill pill-gray">{t('management:teachersPage.noCourses')}</span>}</td>
                    <td>{sessions}</td>
                    <td>
                      <div className="profile-progress-bar" style={{ width: 70 }} title={`${summary?.completionPercent ?? 0}%`}>
                        <div className="profile-progress-fill" style={{ width: `${summary?.completionPercent ?? 0}%` }}></div>
                      </div>
                    </td>
                    <td>
                      {summary?.profileStatus && (
                        <span className={'pill ' + (PROFILE_STATUS_PILL[summary.profileStatus] || 'pill-gray')}>
                          {t(`teacherProfile:profileStatus.${summary.profileStatus}`, summary.profileStatus)}
                        </span>
                      )}
                    </td>
                    <td><div className="row-actions">
                      <button className="btn-sm" onClick={e => { e.stopPropagation(); showSection('teacher-profile', { teacherId: t3.id }); }}>
                        <i className="ti ti-id-badge-2"></i> {t('management:teachersPage.fullProfile')}
                      </button>
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
