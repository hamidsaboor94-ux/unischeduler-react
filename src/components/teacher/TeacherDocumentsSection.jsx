import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import {
  uploadTeacherDocument, downloadTeacherDocument, deleteTeacherDocument,
  verifyTeacherEntity, rejectTeacherEntity,
} from '../../api.js';
import { VerificationBadge, ExpiryBadge, VerifyActions, DOC_TYPES } from './teacherProfileShared.jsx';

/** General document uploads (CV, National ID, Passport, degree certificates, employment
    contract, …) — add-form + table, shared by TeacherProfilePage (Full Profile) and
    FacultyOnboardingPage (wizard Step 5: Documents). */
export default function TeacherDocumentsSection({ teacherId, documents, canWrite, onChanged }) {
  const { t } = useTranslation(['teacherProfile', 'common']);
  const { confirmAction } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const { run: runVerify } = useAsyncAction();

  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const fileRef = useRef(null);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast(t('teacherProfile:documents.errors.fileRequired'), 'warning'); return; }
    try {
      await run(uploadTeacherDocument({ teacherId, docType, issueDate: issueDate || undefined, expiryDate: expiryDate || undefined, file }));
      await onChanged();
      setIssueDate(''); setExpiryDate('');
      if (fileRef.current) fileRef.current.value = '';
      toast(t('teacherProfile:documents.toasts.uploaded'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleDelete(doc) {
    confirmAction(t('teacherProfile:documents.confirmDelete', { fileName: doc.fileName }), async () => {
      try {
        await deleteTeacherDocument(doc.id);
        await onChanged();
        toast(t('teacherProfile:documents.toasts.deleted'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function handleVerify(doc) {
    try {
      await runVerify(verifyTeacherEntity('documents', doc.id));
      await onChanged();
      toast(t('teacherProfile:verification.toasts.verified'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleReject(doc) {
    confirmAction(t('teacherProfile:verification.confirmReject'), async () => {
      try {
        await runVerify(rejectTeacherEntity('documents', doc.id));
        await onChanged();
        toast(t('teacherProfile:verification.toasts.rejected'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  return (
    <div className="panel">
      <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.documents')}</div></div>
      {canWrite && (
        <div className="profile-doc-upload no-print" style={{ flexWrap: 'wrap' }}>
          <select value={docType} onChange={e => setDocType(e.target.value)}>
            {DOC_TYPES.map(v => <option key={v} value={v}>{t(`teacherProfile:documents.types.${v}`)}</option>)}
          </select>
          <label className="field-hint">{t('teacherProfile:documents.issueDate')}<input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} /></label>
          <label className="field-hint">{t('teacherProfile:documents.expiryDate')}<input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></label>
          <input type="file" ref={fileRef} accept=".pdf,.png,.jpg,.jpeg" />
          <button className={'btn-sm' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleUpload}>
            {loading ? <span className="spinner"></span> : <><i className="ti ti-upload"></i> {t('teacherProfile:documents.upload')}</>}
          </button>
        </div>
      )}
      {documents.length === 0 && <div className="field-hint" style={{ padding: '10px 0' }}>{t('teacherProfile:documents.empty')}</div>}
      {documents.length > 0 && (
        <table className="data-table">
          <thead><tr>
            <th>{t('teacherProfile:documents.typeHeader')}</th>
            <th>{t('teacherProfile:documents.fileHeader')}</th>
            <th>{t('teacherProfile:documents.uploadedHeader')}</th>
            <th>{t('teacherProfile:verification.statusHeader')}</th>
            <th className="no-print"></th>
          </tr></thead>
          <tbody>
            {documents.map(doc => (
              <tr key={doc.id}>
                <td>{t(`teacherProfile:documents.types.${doc.docType}`, doc.docType)}</td>
                <td>{doc.fileName}</td>
                <td>{(doc.createdAt || '').split(' ')[0]}</td>
                <td>
                  <VerificationBadge status={doc.verificationStatus} t={t} />{' '}
                  <ExpiryBadge expiryDate={doc.expiryDate} doesNotExpire={false} t={t} />
                </td>
                <td className="no-print"><div className="row-actions">
                  <button className="btn-sm" onClick={() => downloadTeacherDocument(doc.id, doc.fileName)}>
                    <i className="ti ti-download"></i> {t('teacherProfile:documents.download')}
                  </button>
                  <VerifyActions canVerify={canWrite} status={doc.verificationStatus} t={t}
                    onVerify={() => handleVerify(doc)} onReject={() => handleReject(doc)} />
                  {canWrite && (
                    <button className="icon-btn danger" aria-label={t('teacherProfile:documents.delete')} onClick={() => handleDelete(doc)}>
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
