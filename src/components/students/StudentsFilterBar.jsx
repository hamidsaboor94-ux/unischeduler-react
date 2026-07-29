import { useState } from 'react';

// Toolbar + advanced panel for the Students page filter bar. Purely presentational: every value
// and handler is owned by StudentsPage — this component only decides where each control renders
// and how the "applied filters" summary (chips, badge count) is derived from that state.
export default function StudentsFilterBar({
  t, filters, onFilterChange, searchText, onSearchChange, batchText, onBatchChange, onClearBatch,
  flaggedOnly, onFlaggedOnlyChange, onClearAll, onResetAdvanced,
  colleges, departments, programs, studentTypes, courses,
  statusOptions, enrollmentOptions, semesterOptions,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const college = colleges.find(c => String(c.id) === String(filters.collegeId));
  const department = departments.find(d => String(d.id) === String(filters.departmentId));
  const program = programs.find(p => String(p.id) === String(filters.programId));
  const studentType = studentTypes.find(st => String(st.id) === String(filters.studentTypeId));
  const course = courses.find(c => String(c.id) === String(filters.courseId));
  const dateRangeActive = !!(filters.admissionDateFrom || filters.admissionDateTo);

  const advancedCount = [filters.collegeId, filters.programId, filters.studentTypeId, filters.batch, filters.enrollmentStatus, filters.courseId]
    .filter(Boolean).length + (dateRangeActive ? 1 : 0) + (flaggedOnly ? 1 : 0);

  const chips = [];
  if (college) chips.push({ key: 'collegeId', label: college.name, onRemove: () => onFilterChange('collegeId', '', { departmentId: '', programId: '' }) });
  if (department) chips.push({ key: 'departmentId', label: department.name, onRemove: () => onFilterChange('departmentId', '', { programId: '' }) });
  if (program) chips.push({ key: 'programId', label: program.name, onRemove: () => onFilterChange('programId', '') });
  if (studentType) chips.push({ key: 'studentTypeId', label: studentType.name, onRemove: () => onFilterChange('studentTypeId', '') });
  if (filters.semester) chips.push({ key: 'semester', label: t('management:studentsPage.filters.semesterChip', { semester: filters.semester }), onRemove: () => onFilterChange('semester', '') });
  if (filters.batch) chips.push({ key: 'batch', label: filters.batch, onRemove: onClearBatch });
  if (filters.studentStatus) chips.push({ key: 'studentStatus', label: t(`studentProfile:studentStatusOptions.${filters.studentStatus}`), onRemove: () => onFilterChange('studentStatus', '') });
  if (filters.enrollmentStatus) chips.push({ key: 'enrollmentStatus', label: t(`studentProfile:enrollmentOptions.${filters.enrollmentStatus}`), onRemove: () => onFilterChange('enrollmentStatus', '') });
  if (course) chips.push({ key: 'courseId', label: `${course.code} — ${course.name}`, onRemove: () => onFilterChange('courseId', '') });
  if (dateRangeActive) {
    const label = filters.admissionDateFrom && filters.admissionDateTo
      ? `${filters.admissionDateFrom} → ${filters.admissionDateTo}`
      : filters.admissionDateFrom
        ? `${t('management:studentsPage.filters.admissionDateFrom')} ${filters.admissionDateFrom}`
        : `${t('management:studentsPage.filters.admissionDateTo')} ${filters.admissionDateTo}`;
    chips.push({ key: 'enrolledBetween', label, onRemove: () => onFilterChange('admissionDateFrom', '', { admissionDateTo: '' }) });
  }
  if (flaggedOnly) chips.push({ key: 'flaggedOnly', label: t('management:studentsPage.filters.flaggedOnly'), warning: true, onRemove: () => onFlaggedOnlyChange(false) });

  return (
    <div className="panel stf-panel">
      <div className="stf-toolbar">
        <input
          type="text" className="select-sm stf-search"
          aria-label={t('management:studentsPage.searchAriaLabel')}
          placeholder={t('management:studentsPage.searchPlaceholder')}
          value={searchText} onChange={e => onSearchChange(e.target.value)}
        />
        <select className="select-sm" value={filters.departmentId} onChange={e => onFilterChange('departmentId', e.target.value, { programId: '' })} aria-label={t('common:fields.department')}>
          <option value="">{t('management:studentsPage.filters.allDepartments')}</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="select-sm" value={filters.semester} onChange={e => onFilterChange('semester', e.target.value)} aria-label={t('management:studentsPage.filters.allSemesters')}>
          <option value="">{t('management:studentsPage.filters.allSemesters')}</option>
          {semesterOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select-sm" value={filters.studentStatus} onChange={e => onFilterChange('studentStatus', e.target.value)} aria-label={t('management:studentsPage.filters.allStudentStatuses')}>
          <option value="">{t('management:studentsPage.filters.allStudentStatuses')}</option>
          {statusOptions.map(v => <option key={v} value={v}>{t(`studentProfile:studentStatusOptions.${v}`)}</option>)}
        </select>
        <button type="button" className={'btn-sm stf-more-btn' + (advancedOpen ? ' active' : '')} onClick={() => setAdvancedOpen(o => !o)}>
          <i className="ti ti-filter"></i> {t('management:studentsPage.filters.moreFilters')}
          {advancedCount > 0 && <span className="stf-badge">{advancedCount}</span>}
        </button>
      </div>

      {chips.length > 0 && (
        <div className="stf-chips">
          {chips.map(chip => (
            <span key={chip.key} className={'stf-chip' + (chip.warning ? ' stf-chip-warning' : '')}>
              {chip.label}
              <button type="button" className="stf-chip-remove" onClick={chip.onRemove} aria-label={`${t('common:actions.remove')} ${chip.label}`}>×</button>
            </span>
          ))}
          <button type="button" className="stf-clear-all" onClick={onClearAll}>{t('management:studentsPage.filters.clearAll')}</button>
        </div>
      )}

      {advancedOpen && (
        <div className="stf-advanced">
          <div className="stf-advanced-header">
            <span className="panel-title">{t('management:studentsPage.filters.advancedFiltersTitle')}</span>
            <label className="stf-flagged-check">
              <input type="checkbox" checked={flaggedOnly} onChange={e => onFlaggedOnlyChange(e.target.checked)} />
              {t('management:studentsPage.filters.flaggedOnly')}
            </label>
          </div>
          <div className="stf-advanced-grid">
            <div className="stf-group">
              <div className="stf-group-label">{t('management:studentsPage.filters.academicScope')}</div>
              <select className="select-sm" value={filters.collegeId} onChange={e => onFilterChange('collegeId', e.target.value, { departmentId: '', programId: '' })} aria-label={t('management:studentsPage.filters.allColleges')}>
                <option value="">{t('management:studentsPage.filters.allColleges')}</option>
                {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="select-sm" value={filters.programId} onChange={e => onFilterChange('programId', e.target.value)} aria-label={t('management:studentsPage.columns.program')}>
                <option value="">{t('management:studentsPage.filters.allPrograms')}</option>
                {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className="select-sm" value={filters.courseId} onChange={e => onFilterChange('courseId', e.target.value)} aria-label={t('management:studentsPage.filters.allCourses')}>
                <option value="">{t('management:studentsPage.filters.allCourses')}</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div className="stf-group">
              <div className="stf-group-label">{t('management:studentsPage.filters.enrollmentGroup')}</div>
              <input type="text" className="select-sm" placeholder={t('management:studentsPage.filters.batchPlaceholder')} value={batchText} onChange={e => onBatchChange(e.target.value)} aria-label={t('management:studentsPage.filters.batchPlaceholder')} />
              <select className="select-sm" value={filters.enrollmentStatus} onChange={e => onFilterChange('enrollmentStatus', e.target.value)} aria-label={t('management:studentsPage.filters.allEnrollmentStatuses')}>
                <option value="">{t('management:studentsPage.filters.allEnrollmentStatuses')}</option>
                {enrollmentOptions.map(v => <option key={v} value={v}>{t(`studentProfile:enrollmentOptions.${v}`)}</option>)}
              </select>
              <select className="select-sm" value={filters.studentTypeId} onChange={e => onFilterChange('studentTypeId', e.target.value)} aria-label={t('management:studentsPage.filters.allStudentTypes')}>
                <option value="">{t('management:studentsPage.filters.allStudentTypes')}</option>
                {studentTypes.filter(st => st.isActive).map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
              <div className="stf-date-range">
                <span className="field-hint">{t('management:studentsPage.filters.enrolledBetween')}</span>
                <div className="stf-date-inputs">
                  <input type="date" className="select-sm" value={filters.admissionDateFrom} onChange={e => onFilterChange('admissionDateFrom', e.target.value)} aria-label={t('management:studentsPage.filters.admissionDateFrom')} />
                  <span aria-hidden="true">–</span>
                  <input type="date" className="select-sm" value={filters.admissionDateTo} onChange={e => onFilterChange('admissionDateTo', e.target.value)} aria-label={t('management:studentsPage.filters.admissionDateTo')} />
                </div>
              </div>
            </div>
          </div>
          <div className="stf-advanced-footer">
            <button type="button" className="btn-sm" onClick={onResetAdvanced}>{t('common:actions.reset')}</button>
            <button type="button" className="btn-primary" onClick={() => setAdvancedOpen(false)}>{t('management:studentsPage.filters.applyFilters')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
