import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { saveTerm, deleteTerm } from '../../api.js';
import { DAYS, termById } from '../../utils.js';
import { can } from '../../permissions.js';

export default function TermForm({ editId }) {
  const { t } = useTranslation(['management', 'common']);
  const { terms, selectTerm, currentUser, afterMutate } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();

  // Mirrors the server's requireModuleAccess('terms') write check — see RoomForm.jsx for why.
  const canWrite = can(currentUser.role, 'terms', 'write');

  const existing = editId ? termById(terms, editId) : null;
  const seed = existing || {
    name: '', startDate: '', endDate: '', isActive: 0, offDays: '[]', creditLimit: null,
    examStartDate: '', examEndDate: '', registrationOpensAt: '', registrationClosesAt: '',
  };
  let seedOffDays = [];
  try { seedOffDays = JSON.parse(seed.offDays || '[]'); } catch { seedOffDays = []; }

  const [name, setName] = useState(seed.name);
  const [startDate, setStartDate] = useState(seed.startDate || '');
  const [endDate, setEndDate] = useState(seed.endDate || '');
  const [isActive, setIsActive] = useState(!!seed.isActive);
  const [offDays, setOffDays] = useState(seedOffDays);
  const [creditLimit, setCreditLimit] = useState(seed.creditLimit != null ? String(seed.creditLimit) : '');
  const [examStartDate, setExamStartDate] = useState(seed.examStartDate || '');
  const [examEndDate, setExamEndDate] = useState(seed.examEndDate || '');
  const [registrationOpensAt, setRegistrationOpensAt] = useState(seed.registrationOpensAt || '');
  const [registrationClosesAt, setRegistrationClosesAt] = useState(seed.registrationClosesAt || '');

  function toggleOffDay(d) {
    setOffDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

  async function handleSave() {
    if (!name.trim()) { toast(t('management:termForm.validateName'), 'warning'); return; }
    if (examEndDate && examStartDate && examEndDate < examStartDate) {
      toast(t('management:termForm.validateExamRange'), 'warning'); return;
    }
    if (registrationClosesAt && registrationOpensAt && registrationClosesAt < registrationOpensAt) {
      toast(t('management:termForm.validateRegistrationRange'), 'warning'); return;
    }
    try {
      const saved = await run(saveTerm({
        name: name.trim(), startDate: startDate || null, endDate: endDate || null,
        isActive: isActive ? 1 : 0, offDays: JSON.stringify(offDays),
        creditLimit: creditLimit.trim() === '' ? null : Number(creditLimit),
        examStartDate: examStartDate || null, examEndDate: examEndDate || null,
        registrationOpensAt: registrationOpensAt || null, registrationClosesAt: registrationClosesAt || null,
      }, editId));
      closeModal();
      toast(t('management:termForm.toastSaved'));
      // Port of the original's `if (isActive) activeTermId = saved.id;` — explicitly switch the
      // viewed term to the one just marked active, since it may differ from what was being viewed.
      if (isActive) await selectTerm(saved.id);
      else await afterMutate(Promise.resolve());
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleDelete() {
    closeModal();
    confirmAction(t('management:termForm.confirmDelete', { name: seed.name }), () => afterMutate(deleteTerm(editId), t('management:termForm.toastRemoved')));
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('management:termForm.nameLabel')}</div>
          <input type="text" disabled={!canWrite} placeholder={t('management:termForm.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('management:termForm.startDateLabel')}</div>
            <input type="date" disabled={!canWrite} value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-label">{t('management:termForm.endDateLabel')}</div>
            <input type="date" disabled={!canWrite} value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" disabled={!canWrite} checked={isActive} onChange={e => setIsActive(e.target.checked)} /> {t('management:termForm.setActiveLabel')}
        </label>
        <div className="form-row">
          <div className="form-label">{t('management:termForm.nonTeachingDaysLabel')}</div>
          <div className="day-off-grid">
            {DAYS.map(d => (
              <label className="checkbox-row" key={d}>
                <input type="checkbox" disabled={!canWrite} checked={offDays.includes(d)} onChange={() => toggleOffDay(d)} /> {t('common:days.' + d)}
              </label>
            ))}
          </div>
          <div className="field-hint">{t('management:termForm.nonTeachingDaysHint')}</div>
        </div>
        <div className="form-row">
          <div className="form-label">{t('management:termForm.creditLimitLabel')}</div>
          <input type="number" min="1" disabled={!canWrite} placeholder={t('management:termForm.creditLimitPlaceholder')} value={creditLimit} onChange={e => setCreditLimit(e.target.value)} />
          <div className="field-hint">{t('management:termForm.creditLimitHint')}</div>
        </div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('management:termForm.examStartDateLabel')}</div>
            <input type="date" disabled={!canWrite} value={examStartDate} onChange={e => setExamStartDate(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-label">{t('management:termForm.examEndDateLabel')}</div>
            <input type="date" disabled={!canWrite} value={examEndDate} onChange={e => setExamEndDate(e.target.value)} />
          </div>
        </div>
        <div className="field-hint">{t('management:termForm.examRangeHint')}</div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('management:termForm.registrationOpensLabel')}</div>
            <input type="date" disabled={!canWrite} value={registrationOpensAt} onChange={e => setRegistrationOpensAt(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-label">{t('management:termForm.registrationClosesLabel')}</div>
            <input type="date" disabled={!canWrite} value={registrationClosesAt} onChange={e => setRegistrationClosesAt(e.target.value)} />
          </div>
        </div>
        <div className="field-hint">{t('management:termForm.registrationRangeHint')}</div>
      </div>
      <div id="modal-footer" className="modal-footer">
        {editId && canWrite && <button className="modal-danger-btn" onClick={handleDelete}>{t('common:actions.delete')}</button>}
        <button className="btn-sm" onClick={closeModal}>{canWrite ? t('common:actions.cancel') : t('common:actions.close')}</button>
        {canWrite && (
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleSave}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
        </button>
        )}
      </div>
    </>
  );
}
