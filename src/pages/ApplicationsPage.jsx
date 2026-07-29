import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import StudentDetailsCards from '../components/StudentDetailsCards.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import {
  fetchApplications, fetchApplication, submitApplicationAsAdmin, updateApplication,
  uploadApplicationDocument, downloadApplicationDocument, deleteApplicationDocument,
} from '../api.js';
import { fmtDate } from '../utils.js';
import { can } from '../permissions.js';

const ALL_STATUSES = ['Submitted', 'Under Review', 'Entry Test Scheduled', 'Waitlisted', 'Accepted', 'Rejected'];
const PENDING_STATUSES = new Set(['Submitted', 'Under Review', 'Entry Test Scheduled', 'Waitlisted']);
const STATUS_PILL = {
  Submitted: 'pill-blue', 'Under Review': 'pill-amber', 'Entry Test Scheduled': 'pill-amber',
  Waitlisted: 'pill-amber', Accepted: 'pill-green', Rejected: 'pill-red',
};
// StudentDetailsCards only knows a 3-way status — every other admissions status reads as "pending".
const CARD_STATUS = { Accepted: 'accepted', Rejected: 'rejected' };
const DOCUMENT_TYPES = ['ID Scan', 'Certificate', 'Transcript', 'Passport Copy', 'Other'];
const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const AID_TYPES = ['scholarship', 'grant', 'waiver', 'discount'];
const AID_BASES = ['percentage', 'fixed'];
const emptyAidForm = { type: '', basis: 'percentage', value: '', reason: '' };
const FORM_FIELDS = [
  'fullName', 'fatherName', 'grandfatherName', 'gender', 'dateOfBirth', 'nationality', 'nationalId', 'passportNumber',
  'presentAddress', 'permanentAddress', 'mobileNumber', 'emergencyContact', 'personalEmail',
  'previousSchoolName', 'previousGraduationYear', 'desiredDepartmentId', 'entryTestMarks',
];

export default function ApplicationsPage() {
  const { t } = useTranslation(['admissions', 'studentProfile', 'finance', 'common']);
  const { currentUser, departments } = useAppData();
  const { showSection } = useNavigation();
  const { openModal, confirmAction } = useModal();
  const { toast } = useToast();
  const na = t('common:notApplicable');

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tabFilter, setTabFilter] = useState('pending');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState(Object.fromEntries(FORM_FIELDS.map(f => [f, ''])));
  const [docType, setDocType] = useState(DOCUMENT_TYPES[0]);
  const [docTitle, setDocTitle] = useState('');
  const [aidForm, setAidForm] = useState(emptyAidForm);
  const { run: runCreate, loading: creating } = useAsyncAction();
  const { run: runUpload, loading: uploading } = useAsyncAction();
  const { run: runSaveAid, loading: savingAid } = useAsyncAction();

  // Matches POLICY.admissions (registrar:R, admissions_officer:W, dean:R, dept_head:R, viewer:R):
  // everyone entitled to read sees the list/detail; only Admissions Officer (+admin) can act on it.
  const canView = can(currentUser.role, 'admissions', 'read');
  const canWrite = can(currentUser.role, 'admissions', 'write');

  async function refreshList() {
    if (!canView) return;
    setLoading(true);
    try {
      setList(await fetchApplications());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Every page in this app stays mounted at all times regardless of role (see AppShell.jsx) —
    // skip the fetch entirely for a role with no admissions:read.
    if (!canView) return;
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  async function openDetail(id) {
    setSelectedId(id);
    setDetail(null);
    try {
      setDetail(await fetchApplication(id));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function refreshDetail() {
    if (!selectedId) return;
    setDetail(await fetchApplication(selectedId));
    refreshList();
  }

  useEffect(() => {
    if (!detail) { setAidForm(emptyAidForm); return; }
    setAidForm({
      type: detail.aidType || '',
      basis: detail.aidBasis || 'percentage',
      value: detail.aidValue != null ? String(detail.aidValue) : '',
      reason: detail.aidReason || '',
    });
  }, [detail]);

  async function handleSaveAid() {
    if (aidForm.type) {
      const value = Number(aidForm.value);
      if (!(value > 0)) { toast(t('admissions:financialAid.errors.valueRequired'), 'warning'); return; }
      if (aidForm.basis === 'percentage' && value > 100) { toast(t('admissions:financialAid.errors.percentageMax'), 'warning'); return; }
    }
    const payload = aidForm.type
      ? { aidType: aidForm.type, aidBasis: aidForm.basis, aidValue: Number(aidForm.value), aidReason: aidForm.reason.trim() || null }
      : { aidType: null, aidBasis: null, aidValue: null, aidReason: null };
    try {
      await runSaveAid(updateApplication(selectedId, payload));
      toast(t('admissions:financialAid.saved'));
      await refreshDetail();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleCreate() {
    if (!newForm.fullName.trim()) { toast(t('admissions:form.errors.fullNameRequired'), 'warning'); return; }
    if (!newForm.personalEmail.trim()) { toast(t('admissions:form.errors.emailRequired'), 'warning'); return; }
    if (!newForm.desiredDepartmentId) { toast(t('admissions:form.errors.departmentRequired'), 'warning'); return; }
    try {
      const created = await runCreate(submitApplicationAsAdmin(newForm));
      setShowNewForm(false);
      setNewForm(Object.fromEntries(FORM_FIELDS.map(f => [f, ''])));
      toast(t('admissions:toasts.created'));
      await refreshList();
      openDetail(created.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleUploadDocument() {
    if (!docTitle.trim()) { toast(t('studentProfile:documents.errors.titleRequired'), 'warning'); return; }
    const fileInput = document.getElementById('application-doc-file-input');
    const file = fileInput?.files?.[0];
    if (!file) { toast(t('studentProfile:documents.errors.fileRequired'), 'warning'); return; }
    try {
      await runUpload(uploadApplicationDocument(selectedId, { documentType: docType, title: docTitle.trim(), file }));
      setDocTitle('');
      if (fileInput) fileInput.value = '';
      await refreshDetail();
      toast(t('admissions:documents.uploadTitle'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleDeleteDocument(doc) {
    confirmAction(t('admissions:documents.confirmDelete', { title: doc.title }), async () => {
      try {
        await deleteApplicationDocument(selectedId, doc.id);
        await refreshDetail();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  let filtered = list;
  if (tabFilter === 'pending') filtered = filtered.filter(a => PENDING_STATUSES.has(a.status));
  if (statusFilter) filtered = filtered.filter(a => a.status === statusFilter);
  const q = search.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(a => [a.fullName, a.desiredDepartmentName].filter(Boolean).join(' ').toLowerCase().includes(q));
  }

  if (!canView) {
    return (
      <Section name="applications">
        <div className="topbar">
          <i className="ti ti-clipboard-list" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
          <h2>{t('admissions:page.title')}</h2>
        </div>
      </Section>
    );
  }

  return (
    <Section name="applications">
      <div className="topbar">
        <i className="ti ti-clipboard-list" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('admissions:page.title')}</h2>
        {!selectedId && (
          <div className="topbar-actions">
            <div className="tabs">
              <button className={'tab' + (tabFilter === 'pending' ? ' active' : '')} onClick={() => setTabFilter('pending')}>{t('admissions:page.tabs.pending')}</button>
              <button className={'tab' + (tabFilter === 'all' ? ' active' : '')} onClick={() => setTabFilter('all')}>{t('admissions:page.tabs.all')}</button>
            </div>
            <input type="text" className="select-sm" aria-label={t('admissions:page.searchAria')} placeholder={t('admissions:page.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
            <select className="select-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label={t('admissions:page.statusFilterAria')}>
              <option value="">{t('admissions:page.allStatuses')}</option>
              {ALL_STATUSES.map(s => <option key={s} value={s}>{t(`admissions:statuses.${s}`)}</option>)}
            </select>
            {canWrite && <button className="btn-primary" onClick={() => setShowNewForm(true)}><i className="ti ti-plus"></i> {t('admissions:page.newApplication')}</button>}
          </div>
        )}
        {selectedId && (
          <div className="topbar-actions">
            <button className="btn-sm" onClick={() => { setSelectedId(null); setDetail(null); }}><i className="ti ti-arrow-left"></i> {t('admissions:page.backToList')}</button>
          </div>
        )}
      </div>
      <div id="content">
        {!selectedId && showNewForm && (
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-header">
              <div className="panel-title">{t('admissions:adminForm.title')}</div>
              <button className="btn-sm" onClick={() => setShowNewForm(false)}>{t('common:actions.cancel')}</button>
            </div>
            <div className="form-row-2">
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.fullName')}</div><input type="text" value={newForm.fullName} onChange={e => setNewForm(f => ({ ...f, fullName: e.target.value }))} /></div>
              <div className="form-row"><div className="form-label">{t('admissions:form.personalEmailLabel')}</div><input type="email" value={newForm.personalEmail} onChange={e => setNewForm(f => ({ ...f, personalEmail: e.target.value }))} /></div>
            </div>
            <div className="form-row-2">
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.fatherName')}</div><input type="text" value={newForm.fatherName} onChange={e => setNewForm(f => ({ ...f, fatherName: e.target.value }))} /></div>
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.grandfatherName')}</div><input type="text" value={newForm.grandfatherName} onChange={e => setNewForm(f => ({ ...f, grandfatherName: e.target.value }))} /></div>
            </div>
            <div className="form-row-2">
              <div className="form-row">
                <div className="form-label">{t('studentProfile:fields.gender')}</div>
                <select value={newForm.gender} onChange={e => setNewForm(f => ({ ...f, gender: e.target.value }))}>
                  <option value="">{t('studentProfile:select')}</option>
                  {GENDER_OPTIONS.map(g => <option key={g} value={g}>{t(`studentProfile:genderOptions.${g}`)}</option>)}
                </select>
              </div>
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.dateOfBirth')}</div><input type="date" value={newForm.dateOfBirth} onChange={e => setNewForm(f => ({ ...f, dateOfBirth: e.target.value }))} /></div>
            </div>
            <div className="form-row-2">
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.nationality')}</div><input type="text" value={newForm.nationality} onChange={e => setNewForm(f => ({ ...f, nationality: e.target.value }))} /></div>
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.nationalId')}</div><input type="text" value={newForm.nationalId} onChange={e => setNewForm(f => ({ ...f, nationalId: e.target.value }))} /></div>
            </div>
            <div className="form-row-2">
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.passportNumber')}</div><input type="text" value={newForm.passportNumber} onChange={e => setNewForm(f => ({ ...f, passportNumber: e.target.value }))} /></div>
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.mobileNumber')}</div><input type="text" value={newForm.mobileNumber} onChange={e => setNewForm(f => ({ ...f, mobileNumber: e.target.value }))} /></div>
            </div>
            <div className="form-row-2">
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.emergencyContact')}</div><input type="text" value={newForm.emergencyContact} onChange={e => setNewForm(f => ({ ...f, emergencyContact: e.target.value }))} /></div>
              <div className="form-row">
                <div className="form-label">{t('admissions:form.desiredDepartmentLabel')}</div>
                <select value={newForm.desiredDepartmentId} onChange={e => setNewForm(f => ({ ...f, desiredDepartmentId: e.target.value }))}>
                  <option value="">{t('studentProfile:select')}</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row-2">
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.presentAddress')}</div><textarea rows={2} value={newForm.presentAddress} onChange={e => setNewForm(f => ({ ...f, presentAddress: e.target.value }))} /></div>
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.permanentAddress')}</div><textarea rows={2} value={newForm.permanentAddress} onChange={e => setNewForm(f => ({ ...f, permanentAddress: e.target.value }))} /></div>
            </div>
            <div className="form-row-2">
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.previousSchool')}</div><input type="text" value={newForm.previousSchoolName} onChange={e => setNewForm(f => ({ ...f, previousSchoolName: e.target.value }))} /></div>
              <div className="form-row"><div className="form-label">{t('studentProfile:fields.previousGraduationYear')}</div><input type="number" value={newForm.previousGraduationYear} onChange={e => setNewForm(f => ({ ...f, previousGraduationYear: e.target.value }))} /></div>
            </div>
            <div className="form-row"><div className="form-label">{t('studentProfile:fields.entryTestMarks')}</div><input type="number" step="0.01" value={newForm.entryTestMarks} onChange={e => setNewForm(f => ({ ...f, entryTestMarks: e.target.value }))} /></div>
            <button className={'btn-primary' + (creating ? ' btn-loading' : '')} disabled={creating} onClick={handleCreate}>
              {creating ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('admissions:adminForm.submit')}</>}
            </button>
          </div>
        )}

        {!selectedId && (
          <div className="panel">
            {loading && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
            {!loading && filtered.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('admissions:page.empty')}</div>}
            {!loading && filtered.length > 0 && (
              <table className="data-table">
                <thead><tr>
                  <th>{t('admissions:page.table.applicant')}</th>
                  <th>{t('admissions:page.table.department')}</th>
                  <th>{t('admissions:page.table.submitted')}</th>
                  <th>{t('admissions:page.table.source')}</th>
                  <th>{t('admissions:page.table.status')}</th>
                </tr></thead>
                <tbody>
                  {filtered.map(a => (
                    <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(a.id)}>
                      <td>{a.fullName}</td>
                      <td>{a.desiredDepartmentName || na}</td>
                      <td>{(a.createdAt || '').split(' ')[0]}</td>
                      <td>{t(`admissions:page.source.${a.source}`)}</td>
                      <td><span className={'pill ' + (STATUS_PILL[a.status] || 'pill-gray')}>{t(`admissions:statuses.${a.status}`)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {selectedId && !detail && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
        {selectedId && detail && (() => {
          const canConvert = detail.status !== 'Accepted';
          return (
            <>
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">{detail.fullName}</div>
                    <div className="panel-subtitle">{t('admissions:detail.createdOn', { date: (detail.createdAt || '').split(' ')[0] })}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={'pill ' + (STATUS_PILL[detail.status] || 'pill-gray')}>{t(`admissions:statuses.${detail.status}`)}</span>
                    {canWrite && canConvert && (
                      <button className="btn-sm" onClick={() => openModal('application-status-change', null, {
                        applicationId: detail.id, currentStatus: detail.status, fullName: detail.fullName, onUpdated: refreshDetail,
                      })}>
                        {t('admissions:detail.changeStatus')}
                      </button>
                    )}
                    {canWrite && canConvert && (
                      <button className="btn-primary" onClick={() => openModal('application-approve', null, {
                        applicationId: detail.id, desiredDepartmentId: detail.desiredDepartmentId, fullName: detail.fullName, onApproved: refreshDetail,
                      })}>
                        <i className="ti ti-check"></i> {t('admissions:detail.approve')}
                      </button>
                    )}
                  </div>
                </div>
                {detail.status === 'Accepted' && (
                  <div className="alert-item alert-info" style={{ marginBottom: 12 }}>
                    <i className="ti ti-info-circle" style={{ fontSize: 18 }}></i>
                    <div style={{ flex: 1 }}>
                      <div className="alert-desc">{t('admissions:detail.alreadyAccepted')}</div>
                    </div>
                    {detail.createdStudentId && (
                      <button className="btn-sm" onClick={() => showSection('student-profile', { studentId: detail.createdStudentId })}>
                        {t('admissions:detail.viewStudentProfile')}
                      </button>
                    )}
                  </div>
                )}
                {detail.decisionNote && (
                  <div className="form-row">
                    <div className="form-label">{t('admissions:detail.decisionNote')}</div>
                    <div className="form-static">{detail.decisionNote}</div>
                  </div>
                )}
              </div>

              <StudentDetailsCards student={{
                fullName: detail.fullName,
                fatherName: detail.fatherName,
                grandfatherName: detail.grandfatherName,
                gender: detail.gender ? t(`studentProfile:genderOptions.${detail.gender}`) : null,
                dob: detail.dateOfBirth ? fmtDate(detail.dateOfBirth) : null,
                nationality: detail.nationality,
                nationalId: detail.nationalId,
                passportNumber: detail.passportNumber,
                presentAddress: detail.presentAddress,
                permanentAddress: detail.permanentAddress,
                mobile: detail.mobileNumber,
                emergencyContact: detail.emergencyContact,
                email: detail.personalEmail,
                previousSchool: detail.previousSchoolName,
                graduationYear: detail.previousGraduationYear,
                program: detail.desiredDepartmentName,
                entryTestScore: detail.entryTestMarks,
                status: CARD_STATUS[detail.status] || 'pending',
                documents: (detail.documents || []).map(doc => ({
                  type: t(`admissions:documents.types.${doc.documentType}`, doc.documentType),
                  title: doc.title,
                })),
              }} />

              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('admissions:financialAid.title')}</div></div>
                <div className="field-hint" style={{ marginBottom: 10 }}>{t('admissions:financialAid.hint')}</div>
                <div className="fin-form-panel">
                  <div className="fin-form-row">
                    <select className="select-sm" disabled={!canWrite} value={aidForm.type} onChange={e => setAidForm(f => ({ ...f, type: e.target.value }))}>
                      <option value="">{t('admissions:financialAid.none')}</option>
                      {AID_TYPES.map(v => <option key={v} value={v}>{t(`finance:financePage.aid.types.${v}`)}</option>)}
                    </select>
                    {aidForm.type && (
                      <>
                        <select className="select-sm" disabled={!canWrite} value={aidForm.basis} onChange={e => setAidForm(f => ({ ...f, basis: e.target.value }))}>
                          {AID_BASES.map(v => <option key={v} value={v}>{t(`finance:financePage.aid.bases.${v}`)}</option>)}
                        </select>
                        <input type="number" min="0" className="select-sm" style={{ width: 100 }} disabled={!canWrite} placeholder={t('finance:financePage.aid.value')} value={aidForm.value} onChange={e => setAidForm(f => ({ ...f, value: e.target.value }))} />
                        <input type="text" className="select-sm" style={{ width: 180 }} disabled={!canWrite} placeholder={t('finance:financePage.aid.reason')} value={aidForm.reason} onChange={e => setAidForm(f => ({ ...f, reason: e.target.value }))} />
                      </>
                    )}
                    {canWrite && (
                      <button className={'btn-sm' + (savingAid ? ' btn-loading' : '')} disabled={savingAid} onClick={handleSaveAid}>
                        {savingAid ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header"><div className="panel-title">{t('studentProfile:sections.documents')}</div></div>
                {canWrite && (
                  <div className="profile-doc-upload">
                    <select value={docType} onChange={e => setDocType(e.target.value)}>
                      {DOCUMENT_TYPES.map(v => <option key={v} value={v}>{t(`admissions:documents.types.${v}`)}</option>)}
                    </select>
                    <input type="text" placeholder={t('admissions:documents.titlePlaceholder')} value={docTitle} onChange={e => setDocTitle(e.target.value)} />
                    <input id="application-doc-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg" />
                    <button className={'btn-sm' + (uploading ? ' btn-loading' : '')} disabled={uploading} onClick={handleUploadDocument}>
                      {uploading ? <span className="spinner"></span> : <><i className="ti ti-upload"></i> {t('admissions:documents.upload')}</>}
                    </button>
                  </div>
                )}
                {(!detail.documents || detail.documents.length === 0) && <div className="field-hint" style={{ padding: '10px 0' }}>{t('admissions:documents.empty')}</div>}
                {detail.documents && detail.documents.length > 0 && (
                  <table className="data-table">
                    <tbody>
                      {detail.documents.map(doc => (
                        <tr key={doc.id}>
                          <td>{t(`admissions:documents.types.${doc.documentType}`, doc.documentType)}</td>
                          <td>{doc.title}</td>
                          <td>{(doc.createdAt || '').split(' ')[0]}</td>
                          <td><div className="row-actions">
                            <button className="btn-sm" onClick={() => downloadApplicationDocument(selectedId, doc.id, doc.fileName)}>
                              <i className="ti ti-download"></i> {t('admissions:documents.download')}
                            </button>
                            {canWrite && (
                              <button className="icon-btn danger" aria-label={t('admissions:documents.delete')} onClick={() => handleDeleteDocument(doc)}>
                                <i className="ti ti-trash" aria-hidden="true"></i>
                              </button>
                            )}
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          );
        })()}
      </div>
    </Section>
  );
}
