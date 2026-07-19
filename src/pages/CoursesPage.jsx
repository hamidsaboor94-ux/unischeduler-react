import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { useTableSort } from '../hooks/useTableSort.jsx';
import { api, deleteCourse } from '../api.js';
import { departmentName, teacherName, roomName, enrolledCount, csvEscape, downloadFile, parseCsv } from '../utils.js';

/** Applies the Courses page's four filters (dept/instructor/credits/search) — also reused by the
    bulk-assign-department modal to compute its scope, mirroring the original's duplicated logic. */
export function filterCourses(courses, { deptFilter, instructorFilter, creditsFilter, q }) {
  let filtered = courses;
  if (deptFilter === 'none') filtered = filtered.filter(c => !c.departmentId);
  else if (deptFilter) filtered = filtered.filter(c => String(c.departmentId) === deptFilter);
  if (instructorFilter) filtered = filtered.filter(c => String(c.teacherId) === instructorFilter);
  if (creditsFilter) filtered = filtered.filter(c => String(c.credits) === creditsFilter);
  if (q) filtered = filtered.filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  return filtered;
}

export default function CoursesPage() {
  const { t } = useTranslation(['management', 'common']);
  const { currentUser, courses, departments, teachers, rooms, courseRosters, activeTermId, reload, afterMutate } = useAppData();
  const { openModal, confirmAction } = useModal();
  const { toast } = useToast();
  const { run: runImport, loading: importing } = useAsyncAction();
  const importInputRef = useRef(null);

  const isAdmin = currentUser.role === 'admin';
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [instructorFilter, setInstructorFilter] = useState('');
  const [creditsFilter, setCreditsFilter] = useState('');

  const q = search.trim().toLowerCase();
  const filtered = filterCourses(courses, { deptFilter, instructorFilter, creditsFilter, q });
  const { sorted, sortTh, sortArrow } = useTableSort('courses', filtered, {
    code: c => c.code, name: c => c.name, credits: c => c.credits,
    dept: c => departmentName(departments, c.departmentId), instructor: c => teacherName(teachers, c.teacherId),
  });

  const hasNoDeptCourses = courses.some(c => !c.departmentId);
  const distinctCredits = [...new Set(courses.map(c => c.credits))].sort((a, b) => a - b);

  function exportCoursesCsv() {
    const header = [
      t('management:coursesPage.columns.code'), t('management:coursesPage.columns.name'), t('common:fields.department'),
      t('management:coursesPage.columns.credits'), t('management:coursesPage.columns.instructor'), t('common:fields.room'),
      t('management:coursesPage.csvEnrolled'), t('management:coursesPage.csvCapacity'),
    ];
    const rows = courses.map(c => [
      c.code, c.name, departmentName(departments, c.departmentId), c.credits, teacherName(teachers, c.teacherId),
      roomName(rooms, c.roomId), enrolledCount(courseRosters, c.id), c.maxStudents ?? '',
    ]);
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
    downloadFile('courses.csv', csv, 'text/csv');
    toast(t('management:coursesPage.toastExported'));
  }

  async function importCoursesCsv(file) {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) { toast(t('management:coursesPage.toastCsvNoRows'), 'warning'); return; }
    const header = rows[0].map(h => h.trim().toLowerCase());
    const idx = {
      code: header.indexOf('code'),
      name: header.findIndex(h => h === 'name' || h.includes('course name')),
      department: header.findIndex(h => h.startsWith('dep')),
      credits: header.indexOf('credits'),
      instructor: header.indexOf('instructor'),
      room: header.indexOf('room'),
      maxStudents: header.findIndex(h => h.includes('capacity') || h.includes('max')),
    };
    if (idx.code === -1 || idx.name === -1 || idx.department === -1 || idx.credits === -1) {
      toast(t('management:coursesPage.toastCsvMissingColumns'), 'warning');
      return;
    }
    if (!activeTermId) { toast(t('management:coursesPage.toastSelectSemester'), 'warning'); return; }
    const dataRows = rows.slice(1).filter(r => r.some(c => c.trim() !== ''));
    const payload = dataRows.map(r => ({
      code: (r[idx.code] || '').trim(),
      name: (r[idx.name] || '').trim(),
      department: (r[idx.department] || '').trim(),
      credits: (r[idx.credits] || '').trim(),
      instructor: idx.instructor > -1 ? (r[idx.instructor] || '').trim() : '',
      room: idx.room > -1 ? (r[idx.room] || '').trim() : '',
      maxStudents: idx.maxStudents > -1 ? (r[idx.maxStudents] || '').trim() : '',
    }));
    try {
      const result = await runImport(api('POST', '/courses/bulk-import', { rows: payload, termId: activeTermId }));
      await reload();
      toast(
        t('management:coursesPage.toastImported', { count: result.created.length })
        + (result.errors.length ? t('management:coursesPage.toastImportedFailed', { count: result.errors.length }) : '')
      );
      if (result.errors.length) openModal('import-errors', null, { errors: result.errors, title: t('management:coursesPage.importErrorsTitle'), rowLabel: t('management:coursesPage.importErrorsRowLabel') });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function openBulkAssignDept() {
    const scope = filterCourses(courses, { deptFilter, instructorFilter, creditsFilter, q });
    if (!departments.length) { toast(t('management:coursesPage.toastAddDeptFirst'), 'warning'); return; }
    if (!scope.length) { toast(t('management:coursesPage.toastNoCoursesMatch'), 'warning'); return; }
    openModal('bulk-assign-dept', null, { courseIds: scope.map(c => c.id) });
  }

  return (
    <Section name="courses">
      <div className="topbar">
        <i className="ti ti-book" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('management:coursesPage.title')}</h2>
        <div className="topbar-actions">
          <input type="text" className="select-sm" aria-label={t('management:coursesPage.searchAriaLabel')} placeholder={t('management:coursesPage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          <select className="select-sm" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">{t('management:coursesPage.allDepartments')}</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            {hasNoDeptCourses && <option value="none">{t('management:coursesPage.noDepartment')}</option>}
          </select>
          <select className="select-sm" value={instructorFilter} onChange={e => setInstructorFilter(e.target.value)}>
            <option value="">{t('management:coursesPage.allInstructors')}</option>
            {teachers.map(t2 => <option key={t2.id} value={t2.id}>{t2.name}</option>)}
          </select>
          <select className="select-sm" value={creditsFilter} onChange={e => setCreditsFilter(e.target.value)}>
            <option value="">{t('management:coursesPage.allCredits')}</option>
            {distinctCredits.map(cr => <option key={cr} value={cr}>{t('management:coursesPage.creditsOption', { count: cr })}</option>)}
          </select>
          <button className="btn-sm" onClick={exportCoursesCsv}><i className="ti ti-download"></i> {t('common:actions.export')} CSV</button>
          {isAdmin && (
            <>
              <input
                type="file" ref={importInputRef} accept=".csv" style={{ display: 'none' }}
                onChange={e => { importCoursesCsv(e.target.files[0]); e.target.value = ''; }}
              />
              <button className={'btn-sm' + (importing ? ' btn-loading' : '')} disabled={importing} onClick={() => importInputRef.current?.click()}>
                {importing ? <span className="spinner"></span> : <><i className="ti ti-upload"></i> {t('common:actions.import')} CSV</>}
              </button>
              <button className="btn-sm" onClick={openBulkAssignDept}><i className="ti ti-building"></i> {t('management:coursesPage.assignDepartment')}</button>
              <button className="btn-primary" onClick={() => openModal('course')}><i className="ti ti-plus"></i> {t('management:coursesPage.addCourse')}</button>
            </>
          )}
        </div>
      </div>
      <div id="content">
        <div className="panel">
          <table className="data-table">
            <thead><tr>
              <th {...sortTh('code')}>{t('management:coursesPage.columns.code')}{sortArrow('code')}</th>
              <th {...sortTh('name')}>{t('management:coursesPage.columns.name')}{sortArrow('name')}</th>
              <th {...sortTh('dept')}>{t('management:coursesPage.columns.dept')}{sortArrow('dept')}</th>
              <th {...sortTh('credits')}>{t('management:coursesPage.columns.credits')}{sortArrow('credits')}</th>
              <th {...sortTh('instructor')}>{t('management:coursesPage.columns.instructor')}{sortArrow('instructor')}</th>
              <th>{t('common:fields.room')}</th><th>{t('common:fields.status')}</th><th></th>
            </tr></thead>
            <tbody>
              {sorted.map(c => {
                const over = c.maxStudents != null && enrolledCount(courseRosters, c.id) > c.maxStudents;
                return (
                  <tr key={c.id} onClick={() => openModal('course', c.id)}>
                    <td>{c.code}</td><td>{c.name}</td><td>{departmentName(departments, c.departmentId)}</td><td>{c.credits}</td>
                    <td>{teacherName(teachers, c.teacherId)}</td><td>{roomName(rooms, c.roomId)}</td>
                    <td><span className={'pill ' + (over ? 'pill-amber' : 'pill-green')}>{over ? t('management:coursesPage.statusOverEnrolled') : t('management:coursesPage.statusActive')}</span></td>
                    <td><div className="row-actions">
                      {isAdmin && (
                        <button className="icon-btn danger" aria-label={t('management:coursesPage.deleteAria', { code: c.code })} onClick={e => { e.stopPropagation(); confirmAction(t('management:coursesPage.confirmDelete', { code: c.code }), () => afterMutate(deleteCourse(c.id), t('management:coursesPage.toastRemoved'))); }}>
                          <i className="ti ti-trash" aria-hidden="true"></i>
                        </button>
                      )}
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
