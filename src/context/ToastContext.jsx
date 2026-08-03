import { createContext, useContext, useCallback, useState } from 'react';

const ToastContext = createContext(null);

let toastIdSeq = 1;

/** Ephemeral, client-only feedback — form validation, save confirmations, request failures.
    Shown once and auto-dismissed; never written to any store, never shown to any other account,
    and never survives a page reload. This is deliberately the *only* thing toast() does: it must
    never become a second, uncontrolled channel into the persisted per-user notification feed
    (see AppDataContext's `notifications`, sourced from GET /notifications and rendered by
    NotificationPanel.jsx) — that feed is reserved for meaningful domain events on the backend's
    notification type allowlist (see api/src/notificationTypes.js). */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts(list => list.filter(t => t.id !== id));
  }, []);

  /** Shows a toast. `type` is 'info' (default), 'warning', or 'error' — errors and warnings stay
      on screen longer. */
  const toast = useCallback((msg, type = 'info') => {
    const id = toastIdSeq++;
    const duration = type === 'error' ? 6000 : type === 'warning' ? 5000 : 3000;
    setToasts(list => {
      // A single failed operation can be observed by more than one mounted consumer (and
      // development Strict Mode deliberately invokes effects twice). Keep transient feedback
      // useful by showing one active copy of an identical message instead of a toast stack.
      if (list.some(item => item.msg === msg && item.type === type)) return list;
      return [...list, { id, msg, type, duration }];
    });
  }, []);

  const value = { toasts, toast, removeToast };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
