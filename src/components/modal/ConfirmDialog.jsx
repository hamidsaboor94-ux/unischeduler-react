import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';

export default function ConfirmDialog({ message, confirmLabel }) {
  const { t } = useTranslation('common');
  const { closeModal, runPendingConfirm } = useModal();
  return (
    <>
      <div id="modal-body">
        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>{message}</div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('actions.cancel')}</button>
        <button className="modal-danger-btn" style={{ marginInlineEnd: 0 }} onClick={runPendingConfirm}>{confirmLabel || t('actions.delete')}</button>
      </div>
    </>
  );
}
