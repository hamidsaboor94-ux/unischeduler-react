import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { updateApplicationStatus } from '../../api.js';

const STATUS_OPTIONS = ['Submitted', 'Under Review', 'Entry Test Scheduled', 'Waitlisted', 'Rejected'];

/** Every status except Accepted — that one only happens through the dedicated Approve action
    (ApplicationApproveModal), since it does far more than flip a column. */
export default function ApplicationStatusChangeModal({ prefill }) {
  const { t } = useTranslation(['admissions', 'common']);
  const { closeModal } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const [status, setStatus] = useState(prefill.currentStatus === 'Rejected' ? 'Under Review' : prefill.currentStatus);
  const [note, setNote] = useState('');

  async function handleSave() {
    try {
      const result = await run(updateApplicationStatus(prefill.applicationId, { status, decisionNote: note || null }));
      prefill.onUpdated?.(result);
      closeModal();
      if (result.emailSent) toast(t('admissions:statusChangeModal.toasts.emailSent'));
      else if (result.emailError && result.emailError !== 'No email is sent for this status change.') {
        toast(t('admissions:statusChangeModal.toasts.emailFailed', { reason: result.emailError }), 'warning');
      } else {
        toast(t('admissions:statusChangeModal.toasts.updated'));
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('admissions:statusChangeModal.statusLabel')}</div>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{t(`admissions:statuses.${s}`)}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-label">{t('admissions:statusChangeModal.noteLabel')}</div>
          <textarea rows={3} placeholder={t('admissions:statusChangeModal.notePlaceholder')} value={note} onChange={e => setNote(e.target.value)} />
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleSave}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('admissions:statusChangeModal.save')}</>}
        </button>
      </div>
    </>
  );
}
