import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';

export default function TermDropdown() {
  const { t } = useTranslation('shell');
  const { terms, activeTermId, currentUser, isLoading, selectTerm } = useAppData();
  const { openModal } = useModal();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) { if (open && wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    function onKeydown(e) { if (e.key === 'Escape' && open) setOpen(false); }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeydown);
    return () => { document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKeydown); };
  }, [open]);

  const active = terms.find(term => term.id === activeTermId);
  const label = active ? active.name : (isLoading ? t('termDropdown.loading') : (terms.length ? t('termDropdown.selectSemester') : t('termDropdown.noTermsYet')));

  async function handleSelect(value) {
    setOpen(false);
    if (value === '__add__') { openModal('term'); return; }
    await selectTerm(value ? Number(value) : null);
  }

  return (
    <div className={'term-dropdown' + (open ? ' open' : '')} ref={wrapRef}>
      <button
        type="button" className="term-dropdown-toggle"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox" aria-expanded={open} aria-label={t('termDropdown.ariaLabel')}
      >
        <span>{label}</span>
        <i className="ti ti-chevron-down term-dropdown-chevron" aria-hidden="true"></i>
      </button>
      <div className="term-dropdown-list" role="listbox">
        {terms.length
          ? terms.map(t => (
            <button
              type="button" key={t.id}
              className={'term-dropdown-item' + (t.id === activeTermId ? ' active' : '')}
              role="option" aria-selected={t.id === activeTermId}
              onClick={() => handleSelect(t.id)}
            >
              {t.name}
            </button>
          ))
          : <div className="field-hint" style={{ padding: '7px 10px' }}>{t('termDropdown.noTermsYet')}</div>}
        {currentUser?.role === 'admin' && (
          <button type="button" className="term-dropdown-item add-item" onClick={() => handleSelect('__add__')}>
            <i className="ti ti-plus" aria-hidden="true"></i> {t('termDropdown.addSemester')}
          </button>
        )}
      </div>
    </div>
  );
}
