import { useEffect } from 'react';
import { useToast } from '../context/ToastContext.jsx';

function ToastItem({ toast, onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, toast.duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cls = 'toast' + (toast.type === 'error' ? ' toast-error' : toast.type === 'warning' ? ' toast-warning' : '');
  return (
    <div className={cls} role={toast.type === 'error' ? 'alert' : 'status'} aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>
      {toast.msg}
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();
  return (
    <div id="toast-container" aria-live="polite">
      {toasts.map(t => <ToastItem key={t.id} toast={t} onDone={() => removeToast(t.id)} />)}
    </div>
  );
}
