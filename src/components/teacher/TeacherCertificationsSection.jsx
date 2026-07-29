import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import {
  addTeacherCertification, deleteTeacherCertification, downloadTeacherCertificationDocument,
  verifyTeacherEntity, rejectTeacherEntity,
} from '../../api.js';
import { VerificationBadge, ExpiryBadge, VerifyActions } from './teacherProfileShared.jsx';
import { fmtDate } from '../../utils.js';

/** Professional certifications — add-form + table, shared by TeacherProfilePage (Full Profile)
    and FacultyOnboardingPage (wizard Step 3: Education, which also covers certifications). */
export default function TeacherCertificationsSection({ teacherId, certifications, canWrite, onChanged }) {
  const { t } = useTranslation(['teacherProfile', 'common']);
  const { confirmAction } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const { run: runVerify } = useAsyncAction();

  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [noExpiry, setNoExpiry] = useState(false);
  const fileRef = useRef(null);

  async function handleAdd() {
    if (!name.trim()) { toast(t('teacherProfile:certifications.errors.nameRequired'), 'warning'); return; }
    try {
      await run(addTeacherCertification({
        teacherId, name: name.trim(), issuingOrganization: issuer.trim() || undefined,
        certificationNumber: number.trim() || undefined, issueDate: issueDate || undefined,
        expiryDate: noExpiry ? undefined : (expiryDate || undefined), doesNotExpire: noExpiry,
        file: fileRef.current?.files?.[0],
      }));
      await onChanged();
      setName(''); setIssuer(''); setNumber(''); setIssueDate(''); setExpiryDate(''); setNoExpiry(false);
      if (fileRef.current) fileRef.current.value = '';
      toast(t('teacherProfile:certifications.toasts.added'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleDelete(cert) {
    confirmAction(t('teacherProfile:certifications.confirmDelete', { name: cert.name }), async () => {
      try {
        await deleteTeacherCertification(cert.id);
        await onChanged();
        toast(t('teacherProfile:certifications.toasts.deleted'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function handleVerify(cert) {
    try {
      await runVerify(verifyTeacherEntity('certifications', cert.id));
      await onChanged();
      toast(t('teacherProfile:verification.toasts.verified'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleReject(cert) {
    confirmAction(t('teacherProfile:verification.confirmReject'), async () => {
      try {
        await runVerify(rejectTeacherEntity('certifications', cert.id));
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
      <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.certifications')}</div></div>
      {canWrite && (
        <div className="profile-doc-upload no-print" style={{ flexWrap: 'wrap' }}>
          <input type="text" placeholder={t('teacherProfile:certifications.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
          <input type="text" placeholder={t('teacherProfile:certifications.issuerPlaceholder')} value={issuer} onChange={e => setIssuer(e.target.value)} />
          <input type="text" placeholder={t('teacherProfile:certifications.numberPlaceholder')} value={number} onChange={e => setNumber(e.target.value)} style={{ width: 130 }} />
          <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
          {!noExpiry && <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />}
          <label className="field-hint">
            <input type="checkbox" checked={noExpiry} onChange={e => setNoExpiry(e.target.checked)} /> {t('teacherProfile:certifications.doesNotExpire')}
          </label>
          <input type="file" ref={fileRef} accept=".pdf,.png,.jpg,.jpeg" />
          <button className={'btn-sm' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleAdd}>
            {loading ? <span className="spinner"></span> : <><i className="ti ti-plus"></i> {t('teacherProfile:certifications.add')}</>}
          </button>
        </div>
      )}
      {certifications.length === 0 && <div className="field-hint" style={{ padding: '10px 0' }}>{t('teacherProfile:certifications.empty')}</div>}
      {certifications.length > 0 && (
        <table className="data-table">
          <thead><tr>
            <th>{t('teacherProfile:certifications.nameHeader')}</th>
            <th>{t('teacherProfile:certifications.issuerHeader')}</th>
            <th>{t('teacherProfile:certifications.expiryHeader')}</th>
            <th>{t('teacherProfile:verification.statusHeader')}</th>
            <th className="no-print"></th>
          </tr></thead>
          <tbody>
            {certifications.map(cert => (
              <tr key={cert.id}>
                <td>{cert.name}</td>
                <td>{cert.issuingOrganization || na}</td>
                <td>
                  {cert.doesNotExpire ? t('teacherProfile:certifications.doesNotExpire') : (cert.expiryDate ? fmtDate(cert.expiryDate) : na)}{' '}
                  <ExpiryBadge expiryDate={cert.expiryDate} doesNotExpire={!!cert.doesNotExpire} t={t} />
                </td>
                <td><VerificationBadge status={cert.verificationStatus} t={t} /></td>
                <td className="no-print"><div className="row-actions">
                  {cert.documentPath && (
                    <button className="btn-sm" onClick={() => downloadTeacherCertificationDocument(cert.id, `${cert.name}-certificate`)}>
                      <i className="ti ti-download"></i>
                    </button>
                  )}
                  <VerifyActions canVerify={canWrite} status={cert.verificationStatus} t={t}
                    onVerify={() => handleVerify(cert)} onReject={() => handleReject(cert)} />
                  {canWrite && (
                    <button className="icon-btn danger" aria-label={t('teacherProfile:certifications.deleteAria')} onClick={() => handleDelete(cert)}>
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
