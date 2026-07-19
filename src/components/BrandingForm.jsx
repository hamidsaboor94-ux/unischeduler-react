import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { saveBranding, removeLogo, apiUpload } from '../api.js';
import { initials } from '../utils.js';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const MAX_SIZE = 2 * 1024 * 1024;

/** The org-name / brand-color / logo form, shared by the one-time first-run setup screen
    (BrandingSetupScreen) and the later admin Settings page — same fields, same save logic,
    different surrounding chrome and button labels. */
export default function BrandingForm({ submitLabel, showSkip = false, onSkip, onSaved }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const resolvedSubmitLabel = submitLabel || t('common:actions.save');
  const { branding, logoUrl, loadBranding } = useAppData();
  const { toast } = useToast();
  const { run: runSave, loading: saving } = useAsyncAction();
  const { run: runRemove, loading: removing } = useAsyncAction();
  const fileInputRef = useRef(null);

  const [name, setName] = useState(branding.orgName || '');
  const [color, setColor] = useState(branding.brandColor || '#4B7FE8');
  const [emailDomain, setEmailDomain] = useState(branding.emailDomain || 'student.university.edu');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast(t('brandingForm.errors.invalidType'), 'warning');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_SIZE) {
      toast(t('brandingForm.errors.tooLarge'), 'warning');
      e.target.value = '';
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function handleRemoveExistingLogo() {
    try {
      await runRemove(removeLogo());
      await loadBranding();
      toast(t('brandingForm.toasts.logoRemoved'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { toast(t('brandingForm.errors.nameRequired'), 'warning'); return; }
    const trimmedDomain = emailDomain.trim();
    if (!trimmedDomain || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmedDomain)) {
      toast(t('brandingForm.errors.invalidEmailDomain'), 'warning');
      return;
    }
    try {
      await runSave((async () => {
        await saveBranding({ orgName: trimmed, brandColor: color, emailDomain: trimmedDomain });
        if (logoFile) await apiUpload('/settings/branding/logo', 'logo', logoFile);
        await loadBranding();
      })());
      // Clear the pending-upload state now that it's persisted — otherwise the form keeps
      // showing the local file preview (and "Replace image" instead of "Remove logo") until
      // it remounts, even though branding.hasLogo is now true from the server's perspective.
      setLogoFile(null);
      setLogoPreview(null);
      toast(t('brandingForm.toasts.brandingSaved'));
      onSaved?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const showingExistingLogo = !logoPreview && branding.hasLogo;
  const previewSrc = logoPreview || (showingExistingLogo ? logoUrl : null);

  return (
    <>
      <div className="form-row">
        <div className="form-label">{t('brandingForm.orgNameLabel')}</div>
        <input type="text" placeholder={t('brandingForm.orgNamePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div className="form-row">
        <div className="form-label">{t('brandingForm.logoLabel')}</div>
        <div className="logo-picker">
          <div className="logo-preview" style={{ background: previewSrc ? 'transparent' : color }}>
            {previewSrc ? <img src={previewSrc} alt={t('brandingForm.logoPreviewAlt')} /> : (initials(name) || <i className="ti ti-school" aria-hidden="true"></i>)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" className="btn-sm" onClick={() => fileInputRef.current?.click()}>
              <i className="ti ti-upload"></i> {logoFile || showingExistingLogo ? t('brandingForm.replaceImage') : t('brandingForm.uploadImage')}
            </button>
            {showingExistingLogo && !logoFile && (
              <button type="button" className="btn-sm" disabled={removing} onClick={handleRemoveExistingLogo}>
                {removing ? <span className="spinner"></span> : t('brandingForm.removeLogo')}
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: 'none' }} onChange={handleFileChange} />
          </div>
        </div>
        <div className="field-hint">{t('brandingForm.logoHint')}</div>
      </div>

      <div className="form-row">
        <div className="form-label">{t('brandingForm.brandColorLabel')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 44, height: 32, padding: 2, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }} />
          <span className="field-hint" style={{ margin: 0 }}>{t('brandingForm.brandColorHint')}</span>
        </div>
      </div>

      <div className="form-row">
        <div className="form-label">{t('brandingForm.emailDomainLabel')}</div>
        <input type="text" placeholder="student.university.edu" value={emailDomain} onChange={e => setEmailDomain(e.target.value)} />
        <div className="field-hint">{t('brandingForm.emailDomainHint')}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {showSkip && <button type="button" className="btn-sm" onClick={onSkip}>{t('brandingForm.skipForNow')}</button>}
        <button type="button" className={'btn-primary' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handleSave} style={showSkip ? {} : { width: '100%', justifyContent: 'center' }}>
          {saving ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {resolvedSubmitLabel}</>}
        </button>
      </div>
    </>
  );
}
