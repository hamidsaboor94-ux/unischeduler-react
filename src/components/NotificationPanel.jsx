import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';

/** The bell: persisted, per-user server notices only (see GET /notifications, scoped to
    req.user.sub) — meaningful domain events (class cancellations, assignments/announcements
    posted, etc.) that survive across logins, since the recipient may not even be logged in
    when the event happens. Deliberately does NOT show ephemeral toasts (form validation,
    save confirmations, request failures) — those are shown once by ToastContainer.jsx and
    never stored. Panel-open state is local to this component: nothing outside it cares. */
export default function NotificationBell() {
  const { t } = useTranslation('shell');
  const { notifications, dismissAllNotifications } = useAppData();
  const { showSection } = useNavigation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && open && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  const unread = notifications.filter(n => !n.isRead).length;
  const sorted = notifications.slice().sort((a, b) => new Date(b.createdAt + 'Z') - new Date(a.createdAt + 'Z'));

  function handleToggle() {
    if (!open && unread > 0) dismissAllNotifications();
    setOpen(o => !o);
  }

  /** A university-wide announcement notice jumps straight to its full detail (see §18: "Clicking
      the notification opens the full announcement") — every other notification type has no
      dedicated detail page yet, so it just closes the panel where it already reads the message. */
  function handleItemClick(n) {
    if (n.type === 'notice_published' && n.entityId) {
      showSection('announcements', { noticeId: n.entityId });
    }
    setOpen(false);
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button className="icon-btn" title={t('notifications.title')} aria-label={t('notifications.title')} onClick={handleToggle}>
        <i className="ti ti-bell" aria-hidden="true"></i>
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">{t('notifications.title')}</div>
          <div className="notif-panel-list">
            {sorted.length
              ? sorted.map(n => (
                <div
                  className={'notif-item alert' + (n.type === 'notice_published' ? ' notif-item-clickable' : '')}
                  key={n.id}
                  onClick={n.type === 'notice_published' ? () => handleItemClick(n) : undefined}
                  role={n.type === 'notice_published' ? 'button' : undefined}
                  tabIndex={n.type === 'notice_published' ? 0 : undefined}
                >
                  <div>{n.message}</div>
                  <div className="notif-item-time">{new Date(n.createdAt + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              ))
              : <div className="notif-empty">{t('notifications.empty')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
