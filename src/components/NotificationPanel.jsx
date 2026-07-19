import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext.jsx';
import { useAppData } from '../context/AppDataContext.jsx';

/** Merges two notification sources into one time-sorted list for the bell panel:
    - `notificationHistory`: ephemeral, this-session-only toasts (Saved./errors/etc.), unchanged.
    - `notifications`: persisted, per-user server notices (currently: class cancellations) that
      survive across logins — the thing a toast alone can never deliver, since the recipient may
      not even be logged in when the event happens. */
export default function NotificationBell() {
  const { t } = useTranslation('shell');
  const { notificationHistory, unreadNotifCount, notifPanelOpen, toggleNotificationPanel, closeNotificationPanel } = useToast();
  const { notifications, dismissAllNotifications } = useAppData();
  const wrapRef = useRef(null);

  // Port of the global "click outside .notif-wrap closes the panel" listener, scoped to this component.
  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && notifPanelOpen && !wrapRef.current.contains(e.target)) closeNotificationPanel();
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [notifPanelOpen, closeNotificationPanel]);

  const persistedUnread = notifications.filter(n => !n.isRead).length;
  const totalUnread = unreadNotifCount + persistedUnread;

  const merged = [
    ...notifications.map(n => ({ key: `p${n.id}`, msg: n.message, type: 'alert', time: new Date(n.createdAt + 'Z') })),
    ...notificationHistory.map((n, i) => ({ key: `t${i}`, msg: n.msg, type: n.type, time: n.time })),
  ].sort((a, b) => b.time - a.time);

  function handleToggle() {
    if (!notifPanelOpen && persistedUnread > 0) dismissAllNotifications();
    toggleNotificationPanel();
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button className="icon-btn" title={t('notifications.title')} aria-label={t('notifications.title')} onClick={handleToggle}>
        <i className="ti ti-bell" aria-hidden="true"></i>
        {totalUnread > 0 && <span className="notif-badge">{totalUnread > 9 ? '9+' : totalUnread}</span>}
      </button>
      {notifPanelOpen && (
        <div className="notif-panel">
          <div className="notif-panel-header">{t('notifications.title')}</div>
          <div className="notif-panel-list">
            {merged.length
              ? merged.map(n => (
                <div className={'notif-item ' + n.type} key={n.key}>
                  <div>{n.msg}</div>
                  <div className="notif-item-time">{n.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              ))
              : <div className="notif-empty">{t('notifications.empty')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
