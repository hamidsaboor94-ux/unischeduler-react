import { createContext, useContext, useRef, useState } from 'react';

const ModalContext = createContext(null);

export function ModalProvider({ children }) {
  const [modal, setModal] = useState({ type: null, editId: null, prefill: null });
  const pendingConfirmAction = useRef(null);

  function openModal(type, editId = null, prefill = null) {
    setModal({ type, editId, prefill });
  }

  function closeModal() {
    setModal({ type: null, editId: null, prefill: null });
    pendingConfirmAction.current = null;
  }

  /** Port of confirmAction(message, fn) — opens the shared "Are you sure?" modal.
      confirmLabel overrides the confirm button's default "Delete" text for
      destructive actions that aren't deletions (e.g. "Restore backup"). */
  function confirmAction(message, actionFn, confirmLabel) {
    pendingConfirmAction.current = actionFn;
    setModal({ type: 'confirm', editId: null, prefill: { message, confirmLabel } });
  }

  function runPendingConfirm() {
    const action = pendingConfirmAction.current;
    pendingConfirmAction.current = null;
    closeModal();
    if (action) action();
  }

  const value = { modal, openModal, closeModal, confirmAction, runPendingConfirm };
  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within a ModalProvider');
  return ctx;
}
