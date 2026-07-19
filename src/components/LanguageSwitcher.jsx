import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { SUPPORTED_LANGUAGES } from '../i18n/index.js';

/** Language switcher, part of the fixed bottom-right UtilityTray — every account keeps its own
    language preference (see AppDataContext.changeLanguage), so this is available regardless of
    role. Mirrors the notification bell's open/close-on-outside-click pattern right next to it. */
export default function LanguageSwitcher() {
  const { t } = useTranslation('common');
  const { language, changeLanguage } = useAppData();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && open && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  function pick(code) {
    setOpen(false);
    if (code !== language) changeLanguage(code);
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button className="icon-btn" title={t('language.label')} aria-label={t('language.label')} onClick={() => setOpen(o => !o)}>
        <i className="ti ti-language" aria-hidden="true"></i>
      </button>
      {open && (
        <div className="notif-panel lang-panel">
          <div className="notif-panel-header">{t('language.label')}</div>
          <div className="notif-panel-list">
            {SUPPORTED_LANGUAGES.map(l => (
              <button
                key={l.code}
                className={'lang-item' + (l.code === language ? ' active' : '')}
                onClick={() => pick(l.code)}
                dir={l.dir}
              >
                <span>{l.nativeLabel}</span>
                {l.code === language && <i className="ti ti-check" aria-hidden="true"></i>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
