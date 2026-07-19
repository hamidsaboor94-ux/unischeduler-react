import { useEffect } from 'react';

function focusableModalElements(box) {
  if (!box) return [];
  return [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
}

/** Port of focusableModalElements()/modalKeydownHandler()/the focus-save-and-restore logic in
    openModalOverlay()/closeModal() — Escape closes, Tab is trapped inside the modal box, and focus
    returns to whatever was focused before the modal opened. */
export function useModalFocusTrap(isOpen, boxRef, onClose) {
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement;

    const focusable = focusableModalElements(boxRef.current);
    (focusable[0] || boxRef.current)?.focus();

    function handleKeydown(e) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const els = focusableModalElements(boxRef.current);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('keydown', handleKeydown);
      if (previouslyFocused && document.body.contains(previouslyFocused)) previouslyFocused.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
