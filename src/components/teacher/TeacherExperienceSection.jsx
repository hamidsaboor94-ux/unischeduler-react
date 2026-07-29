import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import {
  addTeacherExperience, deleteTeacherExperience, downloadTeacherExperienceDocument,
  verifyTeacherEntity, rejectTeacherEntity,
} from '../../api.js';
import { VerificationBadge, VerifyActions } from './teacherProfileShared.jsx';
import { fmtDate } from '../../utils.js';

/** Prior work experience — add-form + table. Full Profile only; not part of the wizard's fixed
    6 steps, but extracted here for the same reuse/consistency reason as the other sections. */
export default function TeacherExperienceSection({ teacherId, experience, canWrite, onChanged }) {
  const { t } = useTranslation(['teacherProfile', 'common']);
  const { confirmAction } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const { run: runVerify } = useAsyncAction();

  const [organization, setOrganization] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [current, setCurrent] = useState(false);
  const [responsibilities, setResponsibilities] = useState('');
  const fileRef = useRef(null);

  async function handleAdd() {
    if (!organization.trim()) { toast(t('teacherProfile:experience.errors.organizationRequired'), 'warning'); return; }
    try {
      await run(addTeacherExperience({
        teacherId, organization: organization.trim(), position: position.trim() || undefined,
        department: department.trim() || undefined, employmentType: employmentType.trim() || undefined,
        startDate: startDate || undefined, endDate: current ? undefined : (endDate || undefined),
        currentlyWorking: current, responsibilities: responsibilities.trim() || undefined,
        file: fileRef.current?.files?.[0],
      }));
      await onChanged();
      setOrganization(''); setPosition(''); setDepartment(''); setEmploymentType('');
      setStartDate(''); setEndDate(''); setCurrent(false); setResponsibilities('');
      if (fileRef.current) fileRef.current.value = '';
      toast(t('teacherProfile:experience.toasts.added'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleDelete(exp) {
    confirmAction(t('teacherProfile:experience.confirmDelete', { organization: exp.organization }), async () => {
      try {
        await deleteTeacherExperience(exp.id);
        await onChanged();
        toast(t('teacherProfile:experience.toasts.deleted'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function handleVerify(exp) {
    try {
      await runVerify(verifyTeacherEntity('experience', exp.id));
      await onChanged();
      toast(t('teacherProfile:verification.toasts.verified'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleReject(exp) {
    confirmAction(t('teacherProfile:verification.confirmReject'), async () => {
      try {
        await runVerify(rejectTeacherEntity('experience', exp.id));
        await onChanged();
        toast(t('teacherProfile:verification.toasts.rejected'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const na = t('common:notApplicable');

  return (
    <div className="panel">
      <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.experience')}</div></div>
      {canWrite && (
        <div className="profile-doc-upload no-print" style={{ flexWrap: 'wrap' }}>
          <input type="text" placeholder={t('teacherProfile:experience.organizationPlaceholder')} value={organization} onChange={e => setOrganization(e.target.value)} />
          <input type="text" placeholder={t('teacherProfile:experience.positionPlaceholder')} value={position} onChange={e => setPosition(e.target.value)} />
          <input type="text" placeholder={t('teacherProfile:experience.departmentPlaceholder')} value={department} onChange={e => setDepartment(e.target.value)} />
          <input type="text" placeholder={t('teacherProfile:experience.employmentTypePlaceholder')} value={employmentType} onChange={e => setEmploymentType(e.target.value)} style={{ width: 130 }} />
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          {!current && <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />}
          <label className="field-hint">
            <input type="checkbox" checked={current} onChange={e => setCurrent(e.target.checked)} /> {t('teacherProfile:experience.currentlyWorking')}
          </label>
          <input type="text" placeholder={t('teacherProfile:experience.responsibilitiesPlaceholder')} value={responsibilities} onChange={e => setResponsibilities(e.target.value)} style={{ minWidth: 180 }} />
          <input type="file" ref={fileRef} accept=".pdf,.png,.jpg,.jpeg" />
          <button className={'btn-sm' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleAdd}>
            {loading ? <span className="spinner"></span> : <><i className="ti ti-plus"></i> {t('teacherProfile:experience.add')}</>}
          </button>
        </div>
      )}
      {experience.length === 0 && <div className="field-hint" style={{ padding: '10px 0' }}>{t('teacherProfile:experience.empty')}</div>}
      {experience.length > 0 && (
        <table className="data-table">
          <thead><tr>
            <th>{t('teacherProfile:experience.organizationHeader')}</th>
            <th>{t('teacherProfile:experience.positionHeader')}</th>
            <th>{t('teacherProfile:experience.periodHeader')}</th>
            <th>{t('teacherProfile:verification.statusHeader')}</th>
            <th className="no-print"></th>
          </tr></thead>
          <tbody>
            {experience.map(exp => (
              <tr key={exp.id}>
                <td>{exp.organization}</td>
                <td>{exp.position || na}</td>
                <td>{exp.startDate ? fmtDate(exp.startDate) : na} – {exp.currentlyWorking ? t('teacherProfile:experience.currentlyWorking') : (exp.endDate ? fmtDate(exp.endDate) : na)}</td>
                <td><VerificationBadge status={exp.verificationStatus} t={t} /></td>
                <td className="no-print"><div className="row-actions">
                  {exp.documentPath && (
                    <button className="btn-sm" onClick={() => downloadTeacherExperienceDocument(exp.id, `${exp.organization}-certificate`)}>
                      <i className="ti ti-download"></i>
                    </button>
                  )}
                  <VerifyActions canVerify={canWrite} status={exp.verificationStatus} t={t}
                    onVerify={() => handleVerify(exp)} onReject={() => handleReject(exp)} />
                  {canWrite && (
                    <button className="icon-btn danger" aria-label={t('teacherProfile:experience.deleteAria')} onClick={() => handleDelete(exp)}>
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
  );
}
