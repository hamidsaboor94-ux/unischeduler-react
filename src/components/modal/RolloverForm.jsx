import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { api } from '../../api.js';

export default function RolloverForm({ prefill }) {
  const { t } = useTranslation(['management', 'common']);
  const { targetTermId } = prefill;
  const { terms, reload } = useAppData();
  const { closeModal } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const target = terms.find(t => t.id === targetTermId);
  const sourceOptions = terms.filter(t => t.id !== targetTermId);
  const [sourceTermId, setSourceTermId] = useState('');
  const [errors, setErrors] = useState(null);

  async function handleCopy() {
    if (!sourceTermId) { toast(t('management:rolloverForm.toastPickSemester'), 'warning'); return; }
    try {
      const result = await run(api('POST', `/terms/${targetTermId}/rollover`, { sourceTermId: Number(sourceTermId) }));
      await reload();
      toast(
        t('management:rolloverForm.toastCopied', { count: result.created.length })
        + (result.errors.length ? t('management:rolloverForm.toastSkipped', { count: result.errors.length }) : '')
      );
      if (result.errors.length) setErrors(result.errors);
      else closeModal();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (errors) {
    return (
      <>
        <div id="modal-body">
          <div className="roster-list">
            {errors.map((e, i) => (
              <div className="roster-row" key={i}><span>{t('management:rolloverForm.courseLabel', { code: e.code })}</span><span style={{ color: 'var(--danger)' }}>{e.error}</span></div>
            ))}
          </div>
        </div>
        <div id="modal-footer" className="modal-footer">
          <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <label className="form-label">{t('management:rolloverForm.copyFromLabel')}</label>
          <select value={sourceTermId} onChange={e => setSourceTermId(e.target.value)}>
            <option value="">{t('management:rolloverForm.none')}</option>
            {sourceOptions.map(tm => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>
          <div className="field-hint">{t('management:rolloverForm.hint', { target: target.name })}</div>
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleCopy}>
          {loading ? <span className="spinner"></span> : t('management:rolloverForm.copyCourses')}
        </button>
      </div>
    </>
  );
}
