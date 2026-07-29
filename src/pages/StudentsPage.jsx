import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import StudentAvatar from '../components/StudentAvatar.jsx';
import StudentsFilterBar from '../components/students/StudentsFilterBar.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { useTableSort } from '../hooks/useTableSort.jsx';
import { fetchStudents, fetchStudentsExport, bulkUpdateStudents } from '../api.js';
import { can } from '../permissions.js';
import { csvEscape, downloadFile } from '../utils.js';

const ENROLLMENT_OPTIONS = ['Regular', 'Part-time', 'Probation', 'Withdrawn'];
const STUDENT_STATUS_OPTIONS = ['Active', 'Graduated', 'Suspended', 'Withdrawn', 'On Leave'];
const STUDENT_STATUS_PILL = { Active: 'pill-green', Graduated: 'pill-blue', Suspended: 'pill-red', Withdrawn: 'pill-red', 'On Leave': 'pill-amber' };
const FLAG_PILL = { role_mismatch: 'pill-amber', no_account: 'pill-blue', unlinked_user: 'pill-red' };
const SEMESTER_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const emptyFilters = {
  search: '', collegeId: '', departmentId: '', programId: '', studentTypeId: '',
  semester: '', batch: '', studentStatus: '', enrollmentStatus: '', courseId: '',
  admissionDateFrom: '', admissionDateTo: '', notRegisteredTermId: '',
};

export default function StudentsPage() {
  const { t } = useTranslation(['management', 'studentProfile', 'common']);
  const { currentUser, departments, colleges, programs, studentTypes, courses } = useAppData();
  const { activeSection, showSection, sectionFocus } = useNavigation();
  const { toast } = useToast();
  const { run: runBulk, loading: bulkSaving } = useAsyncAction();
  const na = t('common:notApplicable');

  const canWrite = can(currentUser.role, 'students', 'write');
  const canAnnounce = can(currentUser.role, 'announcements', 'write');

  const [filters, setFilters] = useState(emptyFilters);
  const [searchText, setSearchText] = useState('');
  const [batchText, setBatchText] = useState('');
  const debounceRef = useRef(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [viewMode, setViewMode] = useState('table');
  const [selected, setSelected] = useState(new Set());
  const [bulkPanel, setBulkPanel] = useState(null); // null | 'status' | 'reassign'
  const [bulkStatusForm, setBulkStatusForm] = useState({ status: '', reason: '' });
  const [bulkReassignForm, setBulkReassignForm] = useState({ departmentId: '', programId: '' });

  function setFilter(key, value, extra = {}) {
    setFilters(f => ({ ...f, [key]: value, ...extra }));
    setPage(1);
  }

  function handleSearchChange(value) {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setFilter('search', value), 300);
  }
  function handleBatchChange(value) {
    setBatchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setFilter('batch', value), 300);
  }
  function clearFilters() {
    setFilters(emptyFilters);
    setSearchText('');
    setBatchText('');
    setFlaggedOnly(false);
    setPage(1);
  }
  function clearBatch() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setBatchText('');
    setFilter('batch', '');
  }
  function resetAdvancedFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setBatchText('');
    setFlaggedOnly(false);
    setFilters(f => ({
      ...f, collegeId: '', programId: '', studentTypeId: '', batch: '',
      enrollmentStatus: '', courseId: '', admissionDateFrom: '', admissionDateTo: '',
    }));
    setPage(1);
  }

  function buildParams() {
    return {
      search: filters.search, departmentId: filters.departmentId, collegeId: filters.collegeId,
      programId: filters.programId, studentTypeId: filters.studentTypeId, semester: filters.semester,
      batch: filters.batch, studentStatus: filters.studentStatus, status: filters.enrollmentStatus,
      courseId: filters.courseId, admissionDateFrom: filters.admissionDateFrom, admissionDateTo: filters.admissionDateTo,
      notRegisteredTermId: filters.notRegisteredTermId, page, pageSize,
    };
  }

  async function loadStudents() {
    setLoading(true);
    try {
      const res = await fetchStudents(buildParams());
      setData(res);
      setSelected(new Set());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  // This page stays mounted forever (see Section/NavigationContext) — refetch every time it
  // becomes the active section, same convention the old version had, plus whenever a filter or
  // page changes.
  useEffect(() => {
    if (activeSection !== 'students') return;
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, JSON.stringify(filters), page, pageSize]);

  // Deep-link support for the Registrar dashboard's work queue (showSection('students', {...})) —
  // applies once per navigation with a payload, same one-shot convention as other pages reading
  // sectionFocus (see NavigationContext.jsx).
  useEffect(() => {
    if (sectionFocus?.section !== 'students') return;
    // Authoritative over both fields on every fresh navigation — not just turning them on —
    // so an earlier dashboard link's filter doesn't linger into a later, different one (this
    // page stays mounted forever, so its state otherwise persists across navigations).
    setFlaggedOnly(!!sectionFocus.flaggedOnly);
    setFilter('notRegisteredTermId', sectionFocus.notRegisteredTermId || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionFocus]);

  const displayItems = flaggedOnly ? data.items.filter(s => s.kind && s.kind !== 'linked') : data.items;
  const { sorted, sortTh, sortArrow } = useTableSort('students', displayItems, {
    idNumber: s => s.idNumber || '',
    name: s => s.name || '',
    department: s => s.departmentName || '',
    program: s => s.programName || '',
    semester: s => s.programSemester ?? -1,
    batch: s => s.batch || '',
    status: s => s.studentStatus || '',
  });

  const selectableItems = data.items.filter(s => s.kind === 'linked');
  const allSelected = selectableItems.length > 0 && selectableItems.every(s => selected.has(s.id));
  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) selectableItems.forEach(s => next.delete(s.id));
      else selectableItems.forEach(s => next.add(s.id));
      return next;
    });
  }

  function exportRows(rows, filenamePrefix) {
    const header = ['Student ID', 'Name', 'Email', 'Department', 'Program', 'Student Type', 'Semester', 'Batch', 'Enrollment Status', 'Student Status', 'Admission Date'];
    const lines = [header.join(',')];
    for (const s of rows) {
      lines.push([
        s.idNumber || '', s.name || '', s.email || '', s.departmentName || '', s.programName || '',
        s.studentTypeName || '', s.programSemester ?? '', s.batch || '', s.enrollmentStatus || '',
        s.studentStatus || '', s.enrollmentDate || '',
      ].map(csvEscape).join(','));
    }
    downloadFile(`${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv');
  }

  async function handleExportFiltered() {
    try {
      const rows = await fetchStudentsExport(buildParams());
      exportRows(rows, 'students-export');
      toast(t('management:studentsPage.export.toastExported'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  function handleExportSelected() {
    const rows = data.items.filter(s => selected.has(s.id));
    exportRows(rows, 'students-export-selected');
    toast(t('management:studentsPage.export.toastExported'));
  }

  async function handleBulkStatus() {
    if (!bulkStatusForm.status) { toast(t('management:studentsPage.bulk.pickStatus'), 'warning'); return; }
    try {
      const res = await runBulk(bulkUpdateStudents([...selected], { studentStatus: bulkStatusForm.status }, bulkStatusForm.reason));
      await loadStudents();
      setBulkPanel(null);
      setBulkStatusForm({ status: '', reason: '' });
      toast(t('management:studentsPage.bulk.toastUpdated', { count: res.updated }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function handleBulkReassign() {
    const changes = {};
    if (bulkReassignForm.departmentId) changes.departmentId = Number(bulkReassignForm.departmentId);
    if (bulkReassignForm.programId) changes.programId = Number(bulkReassignForm.programId);
    if (!Object.keys(changes).length) { toast(t('management:studentsPage.bulk.pickTarget'), 'warning'); return; }
    try {
      const res = await runBulk(bulkUpdateStudents([...selected], changes));
      await loadStudents();
      setBulkPanel(null);
      setBulkReassignForm({ departmentId: '', programId: '' });
      toast(t('management:studentsPage.bulk.toastUpdated', { count: res.updated }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  function handleSendAnnouncement() {
    const rows = data.items.filter(s => selected.has(s.id));
    showSection('announcements', {
      prefillStudentIds: rows.map(s => s.id),
      prefillStudentUsers: rows.map(s => ({ id: s.id, name: s.name, email: s.email })),
    });
  }

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / pageSize));
  const reassignDepartments = departments;
  const reassignPrograms = programs.filter(p => !bulkReassignForm.departmentId || String(p.departmentId) === String(bulkReassignForm.departmentId));
  const filterDepartments = departments.filter(d => !filters.collegeId || String(d.collegeId) === String(filters.collegeId));
  const filterPrograms = programs.filter(p => !filters.departmentId || String(p.departmentId) === String(filters.departmentId));

  return (
    <Section name="students">
      <div className="topbar">
        <i className="ti ti-users" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('management:studentsPage.title')}</h2>
        <div className="topbar-actions">
          <div className="tabs">
            <button className={'tab' + (viewMode === 'table' ? ' active' : '')} onClick={() => setViewMode('table')}><i className="ti ti-list"></i></button>
            <button className={'tab' + (viewMode === 'card' ? ' active' : '')} onClick={() => setViewMode('card')}><i className="ti ti-layout-grid"></i></button>
          </div>
          <button className="btn-sm" onClick={handleExportFiltered}><i className="ti ti-download"></i> {t('management:studentsPage.export.exportFiltered')}</button>
        </div>
      </div>
      <div id="content">
        <StudentsFilterBar
          t={t}
          filters={filters}
          onFilterChange={setFilter}
          searchText={searchText}
          onSearchChange={handleSearchChange}
          batchText={batchText}
          onBatchChange={handleBatchChange}
          onClearBatch={clearBatch}
          flaggedOnly={flaggedOnly}
          onFlaggedOnlyChange={setFlaggedOnly}
          onClearAll={clearFilters}
          onResetAdvanced={resetAdvancedFilters}
          colleges={colleges}
          departments={filterDepartments}
          programs={filterPrograms}
          studentTypes={studentTypes}
          courses={courses}
          statusOptions={STUDENT_STATUS_OPTIONS}
          enrollmentOptions={ENROLLMENT_OPTIONS}
          semesterOptions={SEMESTER_OPTIONS}
        />

        {selected.size > 0 && (
          <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <strong>{t('management:studentsPage.bulk.selectedCount', { count: selected.size })}</strong>
            {canWrite && <button className="btn-sm" onClick={() => setBulkPanel(bulkPanel === 'status' ? null : 'status')}><i className="ti ti-toggle-right"></i> {t('management:studentsPage.bulk.updateStatus')}</button>}
            {canWrite && <button className="btn-sm" onClick={() => setBulkPanel(bulkPanel === 'reassign' ? null : 'reassign')}><i className="ti ti-transfer"></i> {t('management:studentsPage.bulk.reassign')}</button>}
            <button className="btn-sm" onClick={handleExportSelected}><i className="ti ti-download"></i> {t('management:studentsPage.export.exportSelected')}</button>
            {canAnnounce && <button className="btn-sm" onClick={handleSendAnnouncement}><i className="ti ti-speakerphone"></i> {t('management:studentsPage.bulk.sendAnnouncement')}</button>}
            <button className="btn-sm" onClick={() => setSelected(new Set())}>{t('management:studentsPage.bulk.clearSelection')}</button>

            {bulkPanel === 'status' && (
              <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <select value={bulkStatusForm.status} onChange={e => setBulkStatusForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="">{t('studentProfile:select')}</option>
                  {STUDENT_STATUS_OPTIONS.map(v => <option key={v} value={v}>{t(`studentProfile:studentStatusOptions.${v}`)}</option>)}
                </select>
                <input type="text" placeholder={t('management:studentsPage.bulk.reasonPlaceholder')} value={bulkStatusForm.reason} onChange={e => setBulkStatusForm(f => ({ ...f, reason: e.target.value }))} style={{ flex: 1 }} />
                <button className={'btn-primary' + (bulkSaving ? ' btn-loading' : '')} disabled={bulkSaving} onClick={handleBulkStatus}>
                  {bulkSaving ? <span className="spinner"></span> : t('common:actions.save')}
                </button>
              </div>
            )}
            {bulkPanel === 'reassign' && (
              <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <select value={bulkReassignForm.departmentId} onChange={e => setBulkReassignForm(f => ({ ...f, departmentId: e.target.value, programId: '' }))}>
                  <option value="">{t('management:studentsPage.filters.allDepartments')}</option>
                  {reassignDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select value={bulkReassignForm.programId} onChange={e => setBulkReassignForm(f => ({ ...f, programId: e.target.value }))}>
                  <option value="">{t('management:studentsPage.filters.allPrograms')}</option>
                  {reassignPrograms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button className={'btn-primary' + (bulkSaving ? ' btn-loading' : '')} disabled={bulkSaving} onClick={handleBulkReassign}>
                  {bulkSaving ? <span className="spinner"></span> : t('common:actions.save')}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="panel">
          {loading && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
          {!loading && sorted.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('management:studentsPage.noStudentsMatch')}</div>}

          {!loading && sorted.length > 0 && viewMode === 'table' && (
            <table className="data-table">
              <thead><tr>
                <th><input type="checkbox" checked={allSelected} disabled={!selectableItems.length} onChange={toggleAll} /></th>
                <th></th>
                <th {...sortTh('idNumber')}>{t('management:studentsPage.columns.studentId')}{sortArrow('idNumber')}</th>
                <th {...sortTh('name')}>{t('common:fields.name')}{sortArrow('name')}</th>
                <th {...sortTh('department')}>{t('common:fields.department')}{sortArrow('department')}</th>
                <th {...sortTh('program')}>{t('management:studentsPage.columns.program')}{sortArrow('program')}</th>
                <th {...sortTh('semester')}>{t('management:studentsPage.columns.semester')}{sortArrow('semester')}</th>
                <th {...sortTh('batch')}>{t('management:studentsPage.columns.batch')}{sortArrow('batch')}</th>
                <th {...sortTh('status')}>{t('management:studentsPage.columns.status')}{sortArrow('status')}</th>
                <th></th>
              </tr></thead>
              <tbody>
                {sorted.map(s => {
                  const clickable = s.kind === 'linked' || s.kind === 'role_mismatch';
                  const key = s.kind === 'no_account' ? `app-${s.applicationId}` : `${s.kind || 'linked'}-${s.id}`;
                  return (
                    <tr key={key} onClick={clickable ? () => showSection('student-detail', { studentId: s.id }) : undefined}>
                      <td onClick={e => e.stopPropagation()}>
                        {s.kind === 'linked' && <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} />}
                      </td>
                      <td><StudentAvatar studentId={s.id} name={s.name} photoPath={s.photoPath} /></td>
                      <td><code>{s.idNumber || na}</code></td>
                      <td>
                        {s.name || na}
                        {s.kind === 'no_account' && <div className="field-hint" style={{ marginTop: 2 }}>{t('management:studentsPage.flags.no_account_hint')}</div>}
                        {s.kind === 'unlinked_user' && <div className="field-hint" style={{ marginTop: 2 }}>{t('management:studentsPage.flags.unlinked_user_hint', { id: s.id, sources: (s.sources || []).join(', ') })}</div>}
                      </td>
                      <td>{s.departmentName || na}</td>
                      <td>{s.programName || na}</td>
                      <td>{s.programSemester ?? na}</td>
                      <td>{s.batch || na}</td>
                      <td>
                        {s.kind && s.kind !== 'linked'
                          ? <span className={'pill ' + (FLAG_PILL[s.kind] || 'pill-gray')} title={(s.sources || []).join(', ')}>{t(`management:studentsPage.flags.${s.kind}`)}</span>
                          : (s.studentStatus
                            ? <span className={'pill ' + (STUDENT_STATUS_PILL[s.studentStatus] || 'pill-gray')}>{t(`studentProfile:studentStatusOptions.${s.studentStatus}`)}</span>
                            : na)}
                      </td>
                      <td><div className="row-actions">
                        {clickable && (
                          <>
                            <button className="icon-btn" aria-label={t('management:studentsPage.quickActions.viewProfile')} title={t('management:studentsPage.quickActions.viewProfile')}
                              onClick={e => { e.stopPropagation(); showSection('student-profile', { studentId: s.id }); }}>
                              <i className="ti ti-id-badge-2" aria-hidden="true"></i>
                            </button>
                            {canWrite && s.kind === 'linked' && (
                              <button className="icon-btn" aria-label={t('management:studentsPage.quickActions.edit')} title={t('management:studentsPage.quickActions.edit')}
                                onClick={e => { e.stopPropagation(); showSection('student-profile', { studentId: s.id, autoEdit: true }); }}>
                                <i className="ti ti-pencil" aria-hidden="true"></i>
                              </button>
                            )}
                            <button className="icon-btn" aria-label={t('management:studentsPage.quickActions.academicRecord')} title={t('management:studentsPage.quickActions.academicRecord')}
                              onClick={e => { e.stopPropagation(); showSection('student-detail', { studentId: s.id }); }}>
                              <i className="ti ti-users" aria-hidden="true"></i>
                            </button>
                            {s.kind === 'linked' && (
                              <button className="icon-btn" aria-label={t('management:studentsPage.quickActions.finance')} title={t('management:studentsPage.quickActions.finance')}
                                onClick={e => { e.stopPropagation(); showSection('finance', { studentId: s.id }); }}>
                                <i className="ti ti-cash" aria-hidden="true"></i>
                              </button>
                            )}
                          </>
                        )}
                        {s.kind === 'no_account' && (
                          <button className="btn-sm" onClick={e => { e.stopPropagation(); showSection('applications'); }}>
                            <i className="ti ti-clipboard-check"></i> {t('management:studentsPage.reviewInAdmissions')}
                          </button>
                        )}
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {!loading && sorted.length > 0 && viewMode === 'card' && (
            <div className="student-card-grid">
              {sorted.map(s => {
                const clickable = s.kind === 'linked' || s.kind === 'role_mismatch';
                const key = s.kind === 'no_account' ? `app-${s.applicationId}` : `${s.kind || 'linked'}-${s.id}`;
                return (
                  <div className="student-card" key={key} onClick={clickable ? () => showSection('student-detail', { studentId: s.id }) : undefined}>
                    <div className="student-card-header">
                      <StudentAvatar studentId={s.id} name={s.name} photoPath={s.photoPath} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="student-card-name">{s.name || na}</div>
                        <div className="field-hint">{s.idNumber || na}</div>
                      </div>
                      {s.kind === 'linked' && (
                        <input type="checkbox" checked={selected.has(s.id)} onClick={e => e.stopPropagation()} onChange={() => toggleOne(s.id)} />
                      )}
                    </div>
                    <div className="student-card-meta">
                      {s.departmentName && <span className="pill pill-gray">{s.departmentName}</span>}
                      {s.programName && <span className="pill pill-gray">{s.programName}</span>}
                      {s.programSemester != null && <span className="pill pill-gray">{t('management:studentsPage.semesterPill', { semester: s.programSemester })}</span>}
                      {s.batch && <span className="pill pill-gray">{s.batch}</span>}
                      {s.kind && s.kind !== 'linked'
                        ? <span className={'pill ' + (FLAG_PILL[s.kind] || 'pill-gray')}>{t(`management:studentsPage.flags.${s.kind}`)}</span>
                        : (s.studentStatus && <span className={'pill ' + (STUDENT_STATUS_PILL[s.studentStatus] || 'pill-gray')}>{t(`studentProfile:studentStatusOptions.${s.studentStatus}`)}</span>)}
                    </div>
                    {clickable && (
                      <div className="student-card-actions">
                        <button className="icon-btn" aria-label={t('management:studentsPage.quickActions.viewProfile')} title={t('management:studentsPage.quickActions.viewProfile')}
                          onClick={e => { e.stopPropagation(); showSection('student-profile', { studentId: s.id }); }}>
                          <i className="ti ti-id-badge-2" aria-hidden="true"></i>
                        </button>
                        {canWrite && s.kind === 'linked' && (
                          <button className="icon-btn" aria-label={t('management:studentsPage.quickActions.edit')} title={t('management:studentsPage.quickActions.edit')}
                            onClick={e => { e.stopPropagation(); showSection('student-profile', { studentId: s.id, autoEdit: true }); }}>
                            <i className="ti ti-pencil" aria-hidden="true"></i>
                          </button>
                        )}
                        <button className="icon-btn" aria-label={t('management:studentsPage.quickActions.academicRecord')} title={t('management:studentsPage.quickActions.academicRecord')}
                          onClick={e => { e.stopPropagation(); showSection('student-detail', { studentId: s.id }); }}>
                          <i className="ti ti-users" aria-hidden="true"></i>
                        </button>
                        {s.kind === 'linked' && (
                          <button className="icon-btn" aria-label={t('management:studentsPage.quickActions.finance')} title={t('management:studentsPage.quickActions.finance')}
                            onClick={e => { e.stopPropagation(); showSection('finance', { studentId: s.id }); }}>
                            <i className="ti ti-cash" aria-hidden="true"></i>
                          </button>
                        )}
                      </div>
                    )}
                    {s.kind === 'no_account' && (
                      <div className="student-card-actions">
                        <button className="btn-sm" onClick={e => { e.stopPropagation(); showSection('applications'); }}>
                          <i className="ti ti-clipboard-check"></i> {t('management:studentsPage.reviewInAdmissions')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && data.total > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderTop: '1px solid var(--border)' }}>
              <span className="field-hint">{t('management:studentsPage.pagination.summary', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, data.total), total: data.total })}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select className="select-sm" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{t('management:studentsPage.pagination.perPage', { count: n })}</option>)}
                </select>
                <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><i className="ti ti-chevron-left"></i></button>
                <span className="field-hint">{t('management:studentsPage.pagination.pageOf', { page, totalPages })}</span>
                <button className="btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}><i className="ti ti-chevron-right"></i></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
