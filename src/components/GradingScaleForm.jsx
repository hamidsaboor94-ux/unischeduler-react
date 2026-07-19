import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { fetchGradingScale, saveGradingScale } from '../api.js';

let rowKeySeq = 1;

/** Admin-only form for the single, system-wide percent -> letter-grade scale (mirrors the
    validation in api's gradingScale.js exactly). Saving recomputes every enrolled student's
    final grade in every course immediately, not just on their next mark edit.

    Every page in this app stays mounted at all times regardless of role (see AppShell.jsx),
    so this only fetches for an actual admin — otherwise every faculty/student login would
    silently 403 against this admin-only endpoint the moment the app boots. */
export default function GradingScaleForm() {
  const { t } = useTranslation(['gradebook', 'common']);
  const { currentUser } = useAppData();
  const { toast } = useToast();
  const { run: runSave, loading: saving } = useAsyncAction();
  const [bands, setBands] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    (async () => {
      try {
        const { bands: loaded } = await fetchGradingScale();
        setBands(loaded.map(b => ({ label: b.label, min: String(b.min), point: String(b.point ?? 0), key: rowKeySeq++ })));
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateBand(key, field, value) {
    setBands(prev => prev.map(b => (b.key === key ? { ...b, [field]: value } : b)));
  }

  function addBand() {
    setBands(prev => [...prev, { label: '', min: '0', point: '0', key: rowKeySeq++ }]);
  }

  function removeBand(key) {
    setBands(prev => prev.filter(b => b.key !== key));
  }

  function validate() {
    if (!bands.length) return t('gradingScaleForm.errors.atLeastOne');
    for (const b of bands) {
      if (!b.label.trim()) return t('gradingScaleForm.errors.labelRequired');
      const min = Number(b.min);
      if (b.min === '' || Number.isNaN(min) || min < 0 || min > 100) return t('gradingScaleForm.errors.minRange');
      const point = Number(b.point);
      if (b.point === '' || Number.isNaN(point) || point < 0) return t('gradingScaleForm.errors.pointRange');
    }
    const mins = bands.map(b => Number(b.min));
    if (new Set(mins).size !== mins.length) return t('gradingScaleForm.errors.duplicateMin');
    if (Math.min(...mins) !== 0) return t('gradingScaleForm.errors.lowestMustBeZero');
    return null;
  }

  async function handleSave() {
    const error = validate();
    if (error) { toast(error, 'warning'); return; }
    try {
      const payload = bands.map(b => ({ label: b.label.trim(), min: Number(b.min), point: Number(b.point) }));
      await runSave(saveGradingScale(payload));
      toast(t('gradingScaleForm.toasts.saved'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (loading) return <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>;

  const sortedPreview = [...bands].map(b => ({ ...b, minNum: Number(b.min) })).sort((a, b) => b.minNum - a.minNum);

  return (
    <>
      <div className="field-hint" style={{ marginBottom: 14 }}>{t('gradingScaleForm.hint')}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {bands.map(b => (
          <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="text" placeholder={t('gradingScaleForm.labelPlaceholder')}
              aria-label={t('gradingScaleForm.labelPlaceholder')}
              value={b.label} onChange={e => updateBand(b.key, 'label', e.target.value)}
              style={{ width: 100 }}
            />
            <span className="field-hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>{t('gradingScaleForm.minAndAbove')}</span>
            <input
              type="number" min="0" max="100"
              aria-label={t('gradingScaleForm.minLabel', { label: b.label || '' })}
              value={b.min} onChange={e => updateBand(b.key, 'min', e.target.value)}
              style={{ width: 70 }}
            />
            <span className="field-hint" style={{ margin: 0 }}>%</span>
            <input
              type="number" min="0" step="0.1"
              aria-label={t('gradingScaleForm.pointLabel', { label: b.label || '' })}
              value={b.point} onChange={e => updateBand(b.key, 'point', e.target.value)}
              style={{ width: 60 }}
            />
            <span className="field-hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>{t('gradingScaleForm.pointSuffix')}</span>
            <button type="button" className="icon-btn danger" aria-label={t('common:actions.delete')} onClick={() => removeBand(b.key)}>
              <i className="ti ti-x" aria-hidden="true"></i>
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn-sm" onClick={addBand} style={{ marginBottom: 16 }}>
        <i className="ti ti-plus"></i> {t('gradingScaleForm.addBand')}
      </button>

      {sortedPreview.length > 0 && (
        <div className="field-hint" style={{ marginBottom: 16, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('gradingScaleForm.previewLabel')}</div>
          {sortedPreview.map((b, i) => (
            <div key={b.key}>
              {b.label || '?'} — {i === 0
                ? t('gradingScaleForm.previewTopBand', { min: b.minNum })
                : t('gradingScaleForm.previewRangeBand', { min: b.minNum, max: sortedPreview[i - 1].minNum - 1 })}
            </div>
          ))}
        </div>
      )}

      <button type="button" className={'btn-primary' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handleSave}>
        {saving ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
      </button>
    </>
  );
}
