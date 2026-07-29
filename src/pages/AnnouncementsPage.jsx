import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import NoticeComposer from '../components/NoticeComposer.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';

import { useToast } from '../context/ToastContext.jsx';
import { can } from '../permissions.js';
import { NOTICE_TYPES, PRIORITY_PILL, STATUS_PILL } from '../noticeConstants.js';
import { renderNoticeMessage } from '../noticeMessage.js';
import {
  fetchNotices, fetchNotice, fetchNoticeTargetingOptions, fetchNoticeRecipients, fetchNoticeAnalytics,
  duplicateNotice, archiveNotice, cancelNoticeSchedule, deleteNotice,
  fetchMyNotices, fetchMyNotice, acknowledgeMyNotice, downloadMyNoticeAttachment,
} from '../api.js';

const TABS = ['all', 'draft', 'scheduled', 'published', 'expired', 'archived'];

function fmtDateTime(v) {
  if (!v) return null;
  return new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function ManageList({ t, currentUser, meta }) {
  const { toast } = useToast();
  const { confirmAction } = useModal();
  const { sectionFocus } = useNavigation();
  const [tab, setTab] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const [recipients, setRecipients] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  // Prefilled "Specific Users" target group from the Students page's "Send Announcement" bulk
  // action — see StudentsPage.jsx. sectionFocus is a fresh object on every showSection() call, so
  // this only (re-)fires on an actual new request, never on an unrelated re-render.
  const [prefillGroups, setPrefillGroups] = useState(null);
  useEffect(() => {
    if (sectionFocus?.prefillStudentIds?.length) {
      setPrefillGroups([{ audience: 'users', filters: { userIds: sectionFocus.prefillStudentIds, selectedUsers: sectionFocus.prefillStudentUsers || [] } }]);
      setSelectedId(null);
      setDetail(null);
      setCreating(true);
    }
  }, [sectionFocus]);

  async function refreshList() {
    setLoading(true);
    try {
      setList(await fetchNotices({ status: tab === 'all' ? '' : tab, type: typeFilter, search }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refreshList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, typeFilter, search]);

  async function openDetail(id) {
    setCreating(false);
    setSelectedId(id);
    setDetail(null);
    setRecipients(null);
    setAnalytics(null);
    try {
      setDetail(await fetchNotice(id));
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function refreshDetail(refreshOnly) {
    if (!selectedId) return;
    setDetail(await fetchNotice(selectedId));
    if (!refreshOnly) await refreshList();
  }

  function handleComposerSaved(saved, opts) {
    if (opts?.refreshOnly) { refreshDetail(true); return; }
    refreshList();
    if (saved?.status === 'draft') { openDetail(saved.id); } else { setSelectedId(saved.id); setCreating(false); openDetail(saved.id); }
  }

  async function handleDuplicate(id) {
    try {
      const copy = await duplicateNotice(id);
      toast(t('list.toasts.duplicated'));
      await refreshList();
      openDetail(copy.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function handleArchive(id) {
    confirmAction(t('list.confirmArchive'), async () => {
      try { await archiveNotice(id); toast(t('list.toasts.archived')); await refreshDetail(); } catch (err) { toast(err.message, 'error'); }
    });
  }
  async function handleCancelSchedule(id) {
    confirmAction(t('list.confirmCancelSchedule'), async () => {
      try { await cancelNoticeSchedule(id); toast(t('list.toasts.scheduleCancelled')); await refreshDetail(); } catch (err) { toast(err.message, 'error'); }
    });
  }
  async function handleDelete(id) {
    confirmAction(t('list.confirmDelete'), async () => {
      try { await deleteNotice(id); toast(t('list.toasts.deleted')); setSelectedId(null); setDetail(null); await refreshList(); } catch (err) { toast(err.message, 'error'); }
    });
  }
  async function loadRecipients() {
    try { setRecipients(await fetchNoticeRecipients(selectedId)); } catch (err) { toast(err.message, 'error'); }
  }
  async function loadAnalytics() {
    try { setAnalytics(await fetchNoticeAnalytics(selectedId)); } catch (err) { toast(err.message, 'error'); }
  }

  const canCreate = can(currentUser.role, 'announcements', 'write');

  if (creating) {
    return (
      <NoticeComposer
        meta={meta}
        initialTargetGroups={prefillGroups}
        onSaved={(saved, opts) => { setPrefillGroups(null); handleComposerSaved(saved, opts); }}
        onCancel={() => { setPrefillGroups(null); setCreating(false); }}
      />
    );
  }

  if (selectedId) {
    if (!detail) return <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>;
    if (detail.status === 'draft' || detail.status === 'scheduled') {
      return (
        <>
          <div className="topbar-actions" style={{ marginBottom: 10 }}>
            <button className="btn-sm" onClick={() => { setSelectedId(null); setDetail(null); }}><i className="ti ti-arrow-left"></i> {t('list.backToList')}</button>
            {detail.status === 'scheduled' && <button className="btn-sm" onClick={() => handleCancelSchedule(detail.id)}>{t('list.actions.cancelSchedule')}</button>}
            <button className="icon-btn danger" onClick={() => handleDelete(detail.id)} aria-label={t('list.actions.delete')}><i className="ti ti-trash" aria-hidden="true"></i></button>
          </div>
          <NoticeComposer notice={detail} meta={meta} onSaved={handleComposerSaved} onCancel={() => { setSelectedId(null); setDetail(null); }} />
        </>
      );
    }
    return (
      <>
        <div className="topbar-actions" style={{ marginBottom: 10 }}>
          <button className="btn-sm" onClick={() => { setSelectedId(null); setDetail(null); }}><i className="ti ti-arrow-left"></i> {t('list.backToList')}</button>
          {can(currentUser.role, 'announcements', 'write') && detail.status === 'published' && (
            <button className="btn-sm" onClick={() => setCreating(false)}>{t('list.actions.edit')}</button>
          )}
          <button className="btn-sm" onClick={() => handleDuplicate(detail.id)}><i className="ti ti-copy"></i> {t('list.actions.duplicate')}</button>
          {detail.status !== 'archived' && <button className="btn-sm" onClick={() => handleArchive(detail.id)}>{t('list.actions.archive')}</button>}
        </div>
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">{detail.title}</div>
              <div className="panel-subtitle">
                <span className={'pill ' + (PRIORITY_PILL[detail.priority] || 'pill-gray')}>{t(`priorities.${detail.priority}`)}</span>{' '}
                <span className={'pill ' + (STATUS_PILL[detail.status] || 'pill-gray')}>{t(`statuses.${detail.status}`)}</span>{' '}
                {t(`types.${detail.type}`)} · {detail.createdByName || t('common:notApplicable')}
                {detail.publishedAt && ` · ${fmtDateTime(detail.publishedAt)}`}
              </div>
            </div>
          </div>
          <div className="notice-message" dangerouslySetInnerHTML={{ __html: renderNoticeMessage(detail.message) }} />
          {(detail.attachments || []).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="form-label">{t('composer.fields.attachments')}</div>
              {detail.attachments.map(a => <div key={a.id}>{a.fileName}</div>)}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header"><div className="panel-title">{t('list.recipientsPanel.title')}</div>
            <button className="btn-sm" onClick={loadRecipients}>{t('list.recipientsPanel.load')}</button>
          </div>
          {recipients && (
            recipients.length === 0 ? <div className="field-hint">{t('list.recipientsPanel.empty')}</div> : (
              <table className="data-table">
                <thead><tr><th>{t('list.recipientsPanel.name')}</th><th>{t('list.recipientsPanel.role')}</th><th>{t('list.recipientsPanel.readAt')}</th><th>{t('list.recipientsPanel.ackAt')}</th></tr></thead>
                <tbody>
                  {recipients.map(r => (
                    <tr key={r.userId}>
                      <td>{r.name || r.email}</td><td>{r.role}</td>
                      <td>{fmtDateTime(r.readAt) || '—'}</td><td>{fmtDateTime(r.acknowledgedAt) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>

        <div className="panel">
          <div className="panel-header"><div className="panel-title">{t('list.analyticsPanel.title')}</div>
            <button className="btn-sm" onClick={loadAnalytics}>{t('list.analyticsPanel.load')}</button>
          </div>
          {analytics && (
            <div className="form-row-2">
              <div><strong>{analytics.total}</strong> {t('list.analyticsPanel.total')}</div>
              <div><strong>{analytics.read}</strong> {t('list.analyticsPanel.read')}</div>
              <div><strong>{analytics.unread}</strong> {t('list.analyticsPanel.unread')}</div>
              <div><strong>{analytics.acknowledged}</strong> {t('list.analyticsPanel.acknowledged')}</div>
              <div><strong>{(analytics.readRate * 100).toFixed(1)}%</strong> {t('list.analyticsPanel.readRate')}</div>
              {analytics.acknowledgmentRate != null && <div><strong>{(analytics.acknowledgmentRate * 100).toFixed(1)}%</strong> {t('list.analyticsPanel.ackRate')}</div>}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar-actions" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="tabs">
          {TABS.map(tb => <button key={tb} className={'tab' + (tab === tb ? ' active' : '')} onClick={() => setTab(tb)}>{t(`list.tabs.${tb}`)}</button>)}
        </div>
        <select className="select-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">{t('list.allTypes')}</option>
          {NOTICE_TYPES.map(v => <option key={v} value={v}>{t(`types.${v}`)}</option>)}
        </select>
        <input type="text" className="select-sm" placeholder={t('list.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
        {canCreate && <button className="btn-primary" onClick={() => setCreating(true)}><i className="ti ti-plus"></i> {t('list.newAnnouncement')}</button>}
      </div>
      <div className="panel">
        {loading && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
        {!loading && list.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('list.empty')}</div>}
        {!loading && list.length > 0 && (
          <table className="data-table">
            <thead><tr>
              <th>{t('list.table.title')}</th><th>{t('list.table.type')}</th><th>{t('list.table.recipients')}</th>
              <th>{t('list.table.status')}</th><th>{t('list.table.date')}</th>
            </tr></thead>
            <tbody>
              {list.map(n => (
                <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(n.id)}>
                  <td>{n.pinned ? <i className="ti ti-pin" title={t('list.pinned')}></i> : null} {n.title}</td>
                  <td><span className={'pill ' + (PRIORITY_PILL[n.priority] || 'pill-gray')}>{t(`types.${n.type}`)}</span></td>
                  <td>{n.recipientCount}</td>
                  <td><span className={'pill ' + (STATUS_PILL[n.status] || 'pill-gray')}>{t(`statuses.${n.status}`)}</span></td>
                  <td>{fmtDateTime(n.publishedAt || n.scheduledFor || n.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function MyNoticeDetail({ t, id, onBack, onChanged }) {
  const { toast } = useToast();
  const { showSection } = useNavigation();
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetchMyNotice(id).then(setNotice).catch(err => toast(err.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleAcknowledge() {
    try {
      await acknowledgeMyNotice(id);
      setNotice(n => ({ ...n, acknowledgedAt: new Date().toISOString() }));
      onChanged();
      toast(t('mine.toasts.acknowledged'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!notice) return <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>;
  return (
    <>
      <button className="btn-sm" style={{ marginBottom: 10 }} onClick={onBack}><i className="ti ti-arrow-left"></i> {t('mine.backToList')}</button>
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">{notice.title}</div>
            <div className="panel-subtitle">
              <span className={'pill ' + (PRIORITY_PILL[notice.priority] || 'pill-gray')}>{t(`priorities.${notice.priority}`)}</span>{' '}
              {t(`types.${notice.type}`)} · {notice.createdByName} · {fmtDateTime(notice.publishedAt)}
            </div>
          </div>
        </div>
        <div className="notice-message" dangerouslySetInnerHTML={{ __html: renderNoticeMessage(notice.message) }} />
        {(notice.attachments || []).length > 0 && (
          <div style={{ marginTop: 10 }}>
            {notice.attachments.map(a => (
              <button key={a.id} className="btn-sm" style={{ marginInlineEnd: 6 }} onClick={() => downloadMyNoticeAttachment(notice.id, a.id, a.fileName)}>
                <i className="ti ti-download"></i> {a.fileName}
              </button>
            ))}
          </div>
        )}
        {notice.actionSection && notice.actionLabel && (
          <div style={{ marginTop: 12 }}>
            <button className="btn-sm" onClick={() => showSection(notice.actionSection)}>{notice.actionLabel}</button>
          </div>
        )}
        {notice.requiresAck && (
          <div style={{ marginTop: 12 }}>
            {notice.acknowledgedAt
              ? <span className="pill pill-green"><i className="ti ti-check"></i> {t('mine.acknowledged')}</span>
              : <button className="btn-primary" onClick={handleAcknowledge}><i className="ti ti-check"></i> {t('mine.acknowledgeAction')}</button>}
          </div>
        )}
      </div>
    </>
  );
}

function MyNotices({ t, focusNoticeId }) {
  const { toast } = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(focusNoticeId || null);

  async function refresh() {
    setLoading(true);
    try { setList(await fetchMyNotices()); } catch (err) { toast(err.message, 'error'); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // A bell-notification click (see NotificationPanel.jsx) re-fires this with a fresh noticeId
  // even while already on this page — jump straight to it rather than requiring a second click.
  useEffect(() => { if (focusNoticeId) setSelectedId(focusNoticeId); }, [focusNoticeId]);

  if (selectedId) {
    return <MyNoticeDetail t={t} id={selectedId} onBack={() => { setSelectedId(null); refresh(); }} onChanged={refresh} />;
  }

  return (
    <div className="panel">
      {loading && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
      {!loading && list.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('mine.empty')}</div>}
      {!loading && list.map(n => (
        <div key={n.id} className="notif-item" style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => setSelectedId(n.id)}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {n.pinned && <i className="ti ti-pin" aria-hidden="true"></i>}
            <strong>{n.title}</strong>
            <span className={'pill ' + (PRIORITY_PILL[n.priority] || 'pill-gray')}>{t(`priorities.${n.priority}`)}</span>
            {!n.readAt && <span className="pill pill-blue">{t('mine.unread')}</span>}
            {n.requiresAck && !n.acknowledgedAt && <span className="pill pill-amber">{t('mine.ackRequired')}</span>}
          </div>
          <div className="field-hint">{n.createdByName} · {fmtDateTime(n.publishedAt)}</div>
        </div>
      ))}
    </div>
  );
}

export default function AnnouncementsPage() {
  const { t } = useTranslation(['announcements', 'shell', 'common']);
  const { currentUser } = useAppData();
  const { sectionFocus } = useNavigation();
  const canManage = can(currentUser.role, 'announcements', 'read');
  const [viewMode, setViewMode] = useState(canManage ? 'manage' : 'mine');
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (canManage) fetchNoticeTargetingOptions().then(setMeta).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  // A bell-notification click (see NotificationPanel.jsx) always means "show me that specific
  // announcement" — switch out of the management view for it even if that's what was showing.
  useEffect(() => {
    if (sectionFocus?.noticeId) setViewMode('mine');
    if (sectionFocus?.prefillStudentIds?.length && canManage) setViewMode('manage');
  }, [sectionFocus, canManage]);

  return (
    <Section name="announcements">
      <div className="topbar">
        <i className="ti ti-speakerphone" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('page.title')}</h2>
        {canManage && (
          <div className="topbar-actions">
            <div className="tabs">
              <button className={'tab' + (viewMode === 'manage' ? ' active' : '')} onClick={() => setViewMode('manage')}>{t('page.manageTab')}</button>
              <button className={'tab' + (viewMode === 'mine' ? ' active' : '')} onClick={() => setViewMode('mine')}>{t('page.mineTab')}</button>
            </div>
          </div>
        )}
      </div>
      <div id="content">
        {viewMode === 'manage' && canManage
          ? (meta ? <ManageList t={t} currentUser={currentUser} meta={meta} /> : <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>)
          : <MyNotices t={t} focusNoticeId={sectionFocus?.noticeId} />}
      </div>
    </Section>
  );
}
