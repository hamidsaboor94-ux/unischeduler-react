import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { api } from '../../api.js';

export default function ResetTimetableConfirm({ prefill }) {
  const { t } = useTranslation(['timetable', 'common']);
  const { activeTermId, reload } = useAppData();
  const { closeModal } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const [deep, setDeep] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  async function handleConfirm() {
    try {
      const result = await run(api('POST', '/timetable-import/reset', {
        termId: activeTermId, programSemester: prefill.programSemester, deep,
      }));
      closeModal();
      await reload();
      let message = t('timetable:resetTimetableConfirm.toast.deletedEntries', { count: result.deletedSlots });
      if (result.deletedCourses) message += ` ${t('timetable:resetTimetableConfirm.toast.removedCourses', { count: result.deletedCourses })}`;
      if (result.deletedTeachers) message += ` ${t('timetable:resetTimetableConfirm.toast.removedTeachers', { count: result.deletedTeachers })}`;
      toast(message);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <div id="modal-body">
        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 14 }}>
          <Trans
            i18nKey="timetable:resetTimetableConfirm.body"
            count={prefill.scopeCount}
            values={{ count: prefill.scopeCount, label: prefill.label }}
            components={{ strong: <strong /> }}
          />
        </div>
        <div className="checkbox-row">
          <label><input type="checkbox" checked={deep} onChange={e => setDeep(e.target.checked)} />
            {t('timetable:resetTimetableConfirm.checkboxLabel')}</label>
        </div>
        <div className="field-hint" style={{ marginBottom: 14 }}>{t('timetable:resetTimetableConfirm.skipHint')}</div>
        <div className="form-row">
          <div className="form-label">{t('timetable:resetTimetableConfirm.confirmTypeLabel')}</div>
          <input type="text" autoComplete="off" value={confirmText} onChange={e => setConfirmText(e.target.value)} />
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button
          className={'modal-danger-btn' + (loading ? ' btn-loading' : '')} style={{ marginInlineEnd: 0 }}
          disabled={confirmText !== 'DELETE' || loading} onClick={handleConfirm}
        >
          {loading ? <span className="spinner"></span> : (deep ? t('timetable:resetTimetableConfirm.confirmDeepReset') : t('timetable:resetTimetableConfirm.confirmReset'))}
        </button>
      </div>
    </>
  );
}
