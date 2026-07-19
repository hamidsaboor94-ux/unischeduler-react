import { createContext, useContext, useCallback, useRef, useState } from 'react';

const ToastContext = createContext(null);

let toastIdSeq = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [notificationHistory, setNotificationHistory] = useState([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const notifPanelOpenRef = useRef(false);
  notifPanelOpenRef.current = notifPanelOpen;

  const removeToast = useCallback((id) => {
    setToasts(list => list.filter(t => t.id !== id));
  }, []);

  /** Shows a toast. `type` is 'info' (default), 'warning', or 'error' — errors and warnings stay on
      screen longer and are logged to the notification bell. */
  const toast = useCallback((msg, type = 'info') => {
    const id = toastIdSeq++;
    const duration = type === 'error' ? 6000 : type === 'warning' ? 5000 : 3000;
    setToasts(list => [...list, { id, msg, type, duration }]);

    setNotificationHistory(hist => {
      const next = [{ msg, type, time: new Date() }, ...hist];
      if (next.length > 30) next.length = 30;
      return next;
    });
    setUnreadNotifCount(n => n + 1);
  }, []);

  const toggleNotificationPanel = useCallback(() => {
    setNotifPanelOpen(open => {
      const opening = !open;
      if (opening) setUnreadNotifCount(0);
      return opening;
    });
  }, []);

  const closeNotificationPanel = useCallback(() => setNotifPanelOpen(false), []);

  const value = {
    toasts, toast, removeToast,
    notificationHistory, unreadNotifCount, notifPanelOpen,
    toggleNotificationPanel, closeNotificationPanel,
  };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
