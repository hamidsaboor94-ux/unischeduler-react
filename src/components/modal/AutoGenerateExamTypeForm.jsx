import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useAutoSchedule } from '../../hooks/useSchedulingActions.js';
import { EXAM_TYPES } from '../../utils.js';

/** Asks which exam type to generate before Auto-generate runs — it only builds a schedule for
    the chosen type (e.g. "Midterm"), leaving every other type's exams untouched. Reports the
    result back to the caller (ExamsPage) via prefill.onComplete rather than showing its own
    toast-only summary, so the page's results panel stays the single source of truth. */
export default function AutoGenerateExamTypeForm({ prefill }) {
  const { t } = useTranslation(['academics', 'common']);
  const { closeModal } = useModal();
  const { autoScheduleAll, loading } = useAutoSchedule();
  const [examType, setExamType] = useState(EXAM_TYPES[EXAM_TYPES.length - 1]);

  async function handleGenerate() {
    const result = await autoScheduleAll(examType);
    closeModal();
    prefill?.onComplete?.(result);
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('academics:autoGenerateTypeForm.label')}</div>
          <select value={examType} onChange={e => setExamType(e.target.value)}>
            {EXAM_TYPES.map(v => <option key={v} value={v}>{t(`academics:examForm.types.${v}`)}</option>)}
          </select>
          <div className="field-hint">{t('academics:autoGenerateTypeForm.hint')}</div>
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleGenerate}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-wand"></i> {t('academics:autoGenerateTypeForm.generate')}</>}
        </button>
      </div>
    </>
  );
}
