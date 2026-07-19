import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { fetchGraduationRequirement, saveGraduationRequirement } from '../api.js';

/** Admin-only form for the single, system-wide "credits required to graduate" target shown on
    the Student Profile page's Educational Information section (credits completed vs. required).
    Unset by default (no default guessed) — mirrors GradingScaleForm.jsx's admin-only fetch guard,
    since every page in this app stays mounted regardless of role (see AppShell.jsx). */
export default function GraduationRequirementForm() {
  const { t } = useTranslation(['gradebook', 'common']);
  const { currentUser } = useAppData();
  const { toast } = useToast();
  const { run: runSave, loading: saving } = useAsyncAction();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    (async () => {
      try {
        const { requiredCredits } = await fetchGraduationRequirement();
        setValue(requiredCredits != null ? String(requiredCredits) : '');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      try {
        await runSave(saveGraduationRequirement(null));
        toast(t('graduationRequirementForm.toasts.cleared'));
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) { toast(t('graduationRequirementForm.errors.positiveNumber'), 'warning'); return; }
    try {
      await runSave(saveGraduationRequirement(n));
      toast(t('graduationRequirementForm.toasts.saved'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (loading) return <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>;

  return (
    <>
      <div className="field-hint" style={{ marginBottom: 14 }}>{t('graduationRequirementForm.hint')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <input
          type="number" min="1" step="1"
          placeholder={t('graduationRequirementForm.placeholder')}
          aria-label={t('graduationRequirementForm.inputLabel')}
          value={value} onChange={e => setValue(e.target.value)}
          style={{ width: 110 }}
        />
        <span className="field-hint" style={{ margin: 0 }}>{t('graduationRequirementForm.creditsSuffix')}</span>
      </div>
      <button type="button" className={'btn-primary' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handleSave}>
        {saving ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
      </button>
    </>
  );
}
