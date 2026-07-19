import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { api } from '../../api.js';
import { DAYS } from '../../utils.js';
import { pdfImportRowError, pdfImportEmailLocalPart, pdfImportGroupKey, pdfImportLecturerSummary } from '../../pdfImportHelpers.js';

export default function PdfImportPreview({ prefill }) {
  const { t } = useTranslation(['timetable', 'common']);
  const { activeTermId, departments, teachers, allUsers, reload } = useAppData();
  const { closeModal, openModal } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();

  const [rows, setRows] = useState(prefill.rows);
  const [emailDomain, setEmailDomain] = useState(prefill.emailDomain);
  const [lecturerEmailOverrides, setLecturerEmailOverrides] = useState({});
  const [departmentId, setDepartmentId] = useState('');

  function updateField(index, field, value) {
    setRows(prev => prev.map((row, i) => i === index ? { ...row, [field]: field === 'credits' ? (value === '' ? null : Number(value)) : value } : row));
  }

  function updateLecturerEmail(name, value) {
    setLecturerEmailOverrides(prev => ({ ...prev, [name]: value.trim() }));
  }

  const groups = new Map();
  rows.forEach((row, i) => {
    const key = pdfImportGroupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const [semA, secA] = a.split('|'); const [semB, secB] = b.split('|');
    return (Number(semA) - Number(semB)) || String(secA).localeCompare(String(secB));
  });

  const invalidCount = rows.filter(r => pdfImportRowError(r)).length;
  const lecturers = pdfImportLecturerSummary(rows, teachers, allUsers);
  const newAccountCount = lecturers.filter(l => l.status === 'new' || l.status === 'matched-no-login').length;

  async function handleConfirm() {
    if (!activeTermId) { toast(t('timetable:pdfImportPreview.toasts.selectSemesterFirst'), 'warning'); return; }
    if (!departmentId && departments.length) { toast(t('timetable:pdfImportPreview.toasts.pickDepartment'), 'warning'); return; }
    try {
      const result = await run(api('POST', '/timetable-import/confirm', {
        termId: activeTermId, rows, emailDomain, lecturerEmails: lecturerEmailOverrides, departmentId,
      }));
      closeModal();
      await reload();
      openModal('pdf-import-result', null, result);
      let message = t('timetable:pdfImportPreview.toasts.imported', { count: result.created.slots });
      if (result.created.facultyAccounts) message += ` ${t('timetable:pdfImportPreview.toasts.facultyAccountsCreated', { count: result.created.facultyAccounts })}`;
      toast(message);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <div id="modal-body">
        <div className="pdf-import-summary">
          {t('timetable:pdfImportPreview.summary', { rowCount: rows.length, groupCount: groups.size, lecturerCount: lecturers.length })} {
            invalidCount
              ? <span style={{ color: 'var(--danger)' }}>{t('timetable:pdfImportPreview.rowsNeedAttention', { count: invalidCount })}</span>
              : t('timetable:pdfImportPreview.allRowsComplete')
          }
          {newAccountCount > 0 && <span style={{ color: 'var(--accent)' }}> {t('timetable:pdfImportPreview.newAccountsNotice', { count: newAccountCount })}</span>}
        </div>
        <div className="form-row" style={{ maxWidth: 320 }}>
          <div className="form-label">{t('timetable:pdfImportPreview.departmentLabel')}</div>
          {departments.length ? (
            <>
              <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                <option value="" disabled={!!departmentId}>{t('timetable:pdfImportPreview.selectDepartmentPlaceholder')}</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <div className="field-hint">{t('timetable:pdfImportPreview.departmentHint')}</div>
            </>
          ) : (
            <div className="field-hint" style={{ color: 'var(--warning)' }}>{t('timetable:pdfImportPreview.noDepartmentsWarning')}</div>
          )}
        </div>

        {prefill.warnings.length > 0 && (
          <div className="field-hint" style={{ color: 'var(--warning)', marginBottom: 10 }}>
            {prefill.warnings.map((w, i) => <span key={i}>{w}<br /></span>)}
          </div>
        )}

        {lecturers.length > 0 && (
          <div className="pdf-import-lecturers-scroll">
            <div className="pdf-import-group">
              <div className="pdf-import-group-title">{t('timetable:pdfImportPreview.lecturersTitle')}</div>
              <div className="form-row" style={{ maxWidth: 320 }}>
                <div className="form-label">{t('timetable:pdfImportPreview.loginDomainLabel')}</div>
                <input type="text" value={emailDomain} onChange={e => setEmailDomain(e.target.value.trim())} />
                <div className="field-hint">{t('timetable:pdfImportPreview.loginDomainHint')}</div>
              </div>
              <table className="data-table pdf-import-table">
                <thead><tr><th>{t('timetable:pdfImportPreview.table.lecturer')}</th><th>{t('common:fields.status')}</th><th>{t('timetable:pdfImportPreview.table.loginEmail')}</th></tr></thead>
                <tbody>
                  {lecturers.map(l => {
                    if (l.status === 'placeholder') {
                      return <tr key={l.name}><td>{l.name}</td><td><span className="pill pill-gray">{t('timetable:pdfImportPreview.placeholderSkipped')}</span></td><td className="field-hint">{t('timetable:pdfImportPreview.noAccountCreatedHint')}</td></tr>;
                    }
                    if (l.status === 'matched') {
                      return <tr key={l.name}><td>{l.name}</td><td><span className="pill pill-green">{t('timetable:pdfImportPreview.matchedExistingLogin')}</span></td><td>{l.email || t('common:notApplicable')}</td></tr>;
                    }
                    const badge = l.status === 'matched-no-login'
                      ? <span className="pill pill-amber">{t('timetable:pdfImportPreview.existingTeacherNewLogin')}</span>
                      : <span className="pill pill-blue">{t('timetable:pdfImportPreview.newAccount')}</span>;
                    const emailValue = lecturerEmailOverrides[l.name] || `${pdfImportEmailLocalPart(l.name)}@${emailDomain}`;
                    return (
                      <tr key={l.name}>
                        <td>{l.name}</td><td>{badge}</td>
                        <td><input type="text" value={emailValue} onChange={e => updateLecturerEmail(l.name, e.target.value)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="pdf-import-scroll">
          {sortedKeys.map(key => {
            const [sem, section] = key.split('|');
            return (
              <div className="pdf-import-group" key={key}>
                <div className="pdf-import-group-title">{t('timetable:pdfImportPreview.semesterSectionTitle', { sem, section })}</div>
                <table className="data-table pdf-import-table">
                  <thead><tr><th>{t('timetable:pdfImportPreview.table.day')}</th><th>{t('timetable:pdfImportPreview.table.start')}</th><th>{t('timetable:pdfImportPreview.table.end')}</th><th>{t('common:fields.course')}</th><th>{t('timetable:pdfImportPreview.table.credits')}</th><th>{t('common:fields.teacher')}</th><th>{t('common:fields.room')}</th></tr></thead>
                  <tbody>
                    {groups.get(key).map(i => {
                      const row = rows[i];
                      const err = pdfImportRowError(row);
                      return (
                        <tr key={i} className={err ? 'pdf-import-row-invalid' : ''} title={err || ''}>
                          <td>
                            <select value={row.day} onChange={e => updateField(i, 'day', e.target.value)}>
                              {DAYS.map(d => <option key={d} value={d}>{t('common:days.' + d)}</option>)}
                            </select>
                          </td>
                          <td><input type="time" value={row.startTime || ''} onChange={e => updateField(i, 'startTime', e.target.value)} /></td>
                          <td><input type="time" value={row.endTime || ''} onChange={e => updateField(i, 'endTime', e.target.value)} /></td>
                          <td><input type="text" value={row.courseName || ''} onChange={e => updateField(i, 'courseName', e.target.value)} /></td>
                          <td><input type="number" min="0" style={{ width: 52 }} value={row.credits ?? ''} onChange={e => updateField(i, 'credits', e.target.value)} /></td>
                          <td><input type="text" value={row.teacher || ''} onChange={e => updateField(i, 'teacher', e.target.value)} /></td>
                          <td><input type="text" value={row.room || ''} onChange={e => updateField(i, 'room', e.target.value)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleConfirm}>
          {loading ? <span className="spinner"></span> : t('timetable:pdfImportPreview.confirmImport', { count: rows.length })}
        </button>
      </div>
    </>
  );
}
