import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import NoticeTargetingBuilder from './NoticeTargetingBuilder.jsx';
import { NOTICE_TYPES, NOTICE_PRIORITIES } from '../noticeConstants.js';
import {
  createNotice, updateNotice, publishNotice as apiPublishNotice, scheduleNotice, previewNoticeRecipients,
  searchNoticeUsers, uploadNoticeAttachment, deleteNoticeAttachment, downloadNoticeAttachment,
} from '../api.js';

// In-app destinations an announcement's optional action button may jump to — every value is a
// real NavigationContext section name (see Sidebar.jsx), so "View details" can never point
// anywhere the app itself wouldn't otherwise route the recipient (the destination page still
// enforces its own access control regardless of who could see this announcement).
const ACTION_SECTIONS = [
  { value: 'dashboard', navKey: 'dashboard' },
  { value: 'timetable', navKey: 'timetable' },
  { value: 'courses', navKey: 'courses' },
  { value: 'exams', navKey: 'examSchedule' },
  { value: 'enrollment', navKey: 'enrollment' },
  { value: 'attendance', navKey: 'attendance' },
  { value: 'gradebook', navKey: 'gradebook' },
  { value: 'applications', navKey: 'admissions' },
  { value: 'finance', navKey: 'finance' },
  { value: 'catalog', navKey: 'catalog' },
  { value: 'myschedule', navKey: 'mySchedule' },
  { value: 'my-attendance', navKey: 'myAttendance' },
  { value: 'mygrades', navKey: 'myGrades' },
  { value: 'my-fees', navKey: 'myFees' },
];

function toGroupPayload(groups) {
  // selectedUsers is UI-only bookkeeping (display chips) — never sent to the server, which only
  // ever wants the plain userIds array.
  return groups.map(g => {
    if (g.audience !== 'users') return g;
    const { selectedUsers: _selectedUsers, ...filters } = g.filters || {};
    return { ...g, filters };
  });
}

export default function NoticeComposer({ notice, meta, onSaved, onCancel, initialTargetGroups }) {
  const { t } = useTranslation(['announcements', 'shell', 'common']);
  const { toast } = useToast();
  const { run: runSave, loading: saving } = useAsyncAction();
  const { run: runUpload, loading: uploading } = useAsyncAction();

  const isEditing = !!notice;
  const isPublished = notice?.status === 'published';
  const isLocked = notice && ['archived', 'cancelled', 'expired'].includes(notice.status);

  const [title, setTitle] = useState(notice?.title || '');
  const [message, setMessage] = useState(notice?.message || '');
  const [type, setType] = useState(notice?.type || 'general');
  const [priority, setPriority] = useState(notice?.priority || 'normal');
  const [pinned, setPinned] = useState(!!notice?.pinned);
  const [requiresAck, setRequiresAck] = useState(!!notice?.requiresAck);
  const [actionLabel, setActionLabel] = useState(notice?.actionLabel || '');
  const [actionSection, setActionSection] = useState(notice?.actionSection || '');
  const [expiresAt, setExpiresAt] = useState(notice?.expiresAt ? notice.expiresAt.slice(0, 16) : '');
  // initialTargetGroups only applies when creating a brand-new notice (never overrides an
  // existing one being edited) — used by the Students page's "Send Announcement" bulk action to
  // pre-seed a "Specific Users" target group with the rows the user had checked there.
  const [groups, setGroups] = useState(notice?.targetGroups || initialTargetGroups || []);
  const [notifyOnUpdate, setNotifyOnUpdate] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState(notice?.scheduledFor ? notice.scheduledFor.slice(0, 16) : '');
  const [preview, setPreview] = useState({ loading: false, total: null, perGroup: [] });
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const meaningful = groups.filter(g => (g.audience !== 'roles' && g.audience !== 'users') || (g.filters?.roles?.length || g.filters?.userIds?.length));
    if (!meaningful.length) { setPreview({ loading: false, total: null, perGroup: [] }); return; }
    setPreview(p => ({ ...p, loading: true }));
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await previewNoticeRecipients(toGroupPayload(meaningful));
        setPreview({ loading: false, total: result.total, perGroup: result.perGroup });
      } catch (err) {
        setPreview({ loading: false, total: null, perGroup: [], error: err.message });
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(groups)]);

  function buildBody(action) {
    return {
      title, message, type, priority, pinned, requiresAck,
      actionLabel: actionLabel || null, actionSection: actionSection || null,
      expiresAt: expiresAt || null, action, scheduledFor: scheduledFor || null,
      targetGroups: toGroupPayload(groups),
    };
  }

  function validateBasics() {
    if (!title.trim()) { toast(t('composer.errors.titleRequired'), 'warning'); return false; }
    if (!message.trim()) { toast(t('composer.errors.messageRequired'), 'warning'); return false; }
    return true;
  }

  async function handleSaveDraft() {
    if (!validateBasics()) return;
    try {
      const saved = isEditing
        ? await runSave(updateNotice(notice.id, buildBody('draft')))
        : await runSave(createNotice(buildBody('draft')));
      toast(t('composer.toasts.draftSaved'));
      onSaved(saved);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handlePublishNow() {
    if (!validateBasics()) return;
    if (!groups.length) { toast(t('composer.errors.recipientsRequired'), 'warning'); return; }
    try {
      let saved;
      if (isEditing) {
        // Persist any field/targeting edits made in this session before flipping status —
        // otherwise re-publishing a reopened scheduled draft would silently drop them.
        await runSave(updateNotice(notice.id, buildBody('draft')));
        saved = await runSave(apiPublishNotice(notice.id));
      } else {
        saved = await runSave(createNotice(buildBody('publish')));
      }
      toast(t('composer.toasts.published', { count: saved.recipientCount ?? '' }));
      onSaved(saved);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleConfirmSchedule() {
    if (!validateBasics()) return;
    if (!groups.length) { toast(t('composer.errors.recipientsRequired'), 'warning'); return; }
    if (!scheduledFor) { toast(t('composer.errors.scheduleRequired'), 'warning'); return; }
    try {
      let saved;
      if (isEditing) {
        await runSave(updateNotice(notice.id, buildBody('draft')));
        saved = await runSave(scheduleNotice(notice.id, scheduledFor));
      } else {
        saved = await runSave(createNotice(buildBody('schedule')));
      }
      toast(t('composer.toasts.scheduled'));
      onSaved(saved);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleSaveEdits() {
    if (!validateBasics()) return;
    try {
      const body = buildBody(notice.status);
      body.notifyOnUpdate = notifyOnUpdate;
      const saved = await runSave(updateNotice(notice.id, body));
      toast(t('composer.toasts.updated'));
      onSaved(saved);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleUploadAttachment() {
    const input = document.getElementById('notice-attachment-input');
    const file = input?.files?.[0];
    if (!file) { toast(t('composer.errors.fileRequired'), 'warning'); return; }
    try {
      await runUpload(uploadNoticeAttachment(notice.id, file));
      if (input) input.value = '';
      onSaved(notice, { refreshOnly: true });
      toast(t('composer.toasts.attachmentUploaded'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const canRetarget = !notice || notice.status === 'draft' || notice.status === 'scheduled';

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">{isEditing ? t('composer.editTitle') : t('composer.createTitle')}</div>
        <button className="btn-sm" onClick={onCancel}>{t('common:actions.cancel')}</button>
      </div>

      {isLocked && <div className="alert-item alert-info" style={{ marginBottom: 12 }}><i className="ti ti-lock" style={{ fontSize: 18 }}></i><div className="alert-desc">{t('composer.lockedNotice')}</div></div>}

      <div className="form-row">
        <div className="form-label">{t('composer.fields.title')}</div>
        <input type="text" value={title} disabled={isLocked} onChange={e => setTitle(e.target.value)} placeholder={t('composer.fields.titlePlaceholder')} />
      </div>
      <div className="form-row">
        <div className="form-label">{t('composer.fields.message')}</div>
        <textarea rows={5} value={message} disabled={isLocked} onChange={e => setMessage(e.target.value)} placeholder={t('composer.fields.messagePlaceholder')} />
        <div className="field-hint">{t('composer.fields.messageHint')}</div>
      </div>
      <div className="form-row-2">
        <div className="form-row">
          <div className="form-label">{t('composer.fields.type')}</div>
          <select value={type} disabled={isLocked} onChange={e => setType(e.target.value)}>
            {NOTICE_TYPES.map(v => <option key={v} value={v}>{t(`types.${v}`)}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-label">{t('composer.fields.priority')}</div>
          <select value={priority} disabled={isLocked} onChange={e => setPriority(e.target.value)}>
            {NOTICE_PRIORITIES.map(v => <option key={v} value={v}>{t(`priorities.${v}`)}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row-2">
        <label className="form-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={pinned} disabled={isLocked} onChange={e => setPinned(e.target.checked)} /> {t('composer.fields.pinned')}
        </label>
        <label className="form-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={requiresAck} disabled={isLocked} onChange={e => setRequiresAck(e.target.checked)} /> {t('composer.fields.requiresAck')}
        </label>
      </div>
      <div className="form-row-2">
        <div className="form-row">
          <div className="form-label">{t('composer.fields.actionLabel')}</div>
          <input type="text" value={actionLabel} disabled={isLocked} onChange={e => setActionLabel(e.target.value)} placeholder={t('composer.fields.actionLabelPlaceholder')} />
        </div>
        <div className="form-row">
          <div className="form-label">{t('composer.fields.actionSection')}</div>
          <select value={actionSection} disabled={isLocked} onChange={e => setActionSection(e.target.value)}>
            <option value="">{t('composer.fields.actionSectionNone')}</option>
            {ACTION_SECTIONS.map(s => <option key={s.value} value={s.value}>{t(`shell:sidebar.nav.${s.navKey}`)}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-label">{t('composer.fields.expiresAt')}</div>
        <input type="datetime-local" value={expiresAt} disabled={isLocked} onChange={e => setExpiresAt(e.target.value)} />
      </div>

      {isEditing && (
        <div className="form-row">
          <div className="form-label">{t('composer.fields.attachments')}</div>
          {(notice.attachments || []).length === 0 && <div className="field-hint">{t('composer.fields.noAttachments')}</div>}
          {(notice.attachments || []).length > 0 && (
            <table className="data-table">
              <tbody>
                {notice.attachments.map(a => (
                  <tr key={a.id}>
                    <td>{a.fileName}</td>
                    <td><div className="row-actions">
                      <button className="btn-sm" onClick={() => downloadNoticeAttachment(notice.id, a.id, a.fileName)}><i className="ti ti-download"></i></button>
                      {!isLocked && !isPublished && (
                        <button className="icon-btn danger" onClick={async () => { await deleteNoticeAttachment(notice.id, a.id); onSaved(notice, { refreshOnly: true }); }}>
                          <i className="ti ti-trash" aria-hidden="true"></i>
                        </button>
                      )}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!isLocked && (
            <div className="profile-doc-upload" style={{ marginTop: 8 }}>
              <input id="notice-attachment-input" type="file" />
              <button className={'btn-sm' + (uploading ? ' btn-loading' : '')} disabled={uploading} onClick={handleUploadAttachment}>
                {uploading ? <span className="spinner"></span> : <><i className="ti ti-upload"></i> {t('composer.fields.uploadAttachment')}</>}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="form-row">
        <div className="form-label">{t('composer.sendTo')}</div>
        {canRetarget ? (
          <NoticeTargetingBuilder groups={groups} onChange={setGroups} meta={meta} searchUsers={searchNoticeUsers} disabled={isLocked} />
        ) : (
          <div className="alert-item alert-info">
            <i className="ti ti-snowflake" style={{ fontSize: 18 }}></i>
            <div className="alert-desc">{t('composer.targetingFrozen')}</div>
          </div>
        )}
      </div>

      {canRetarget && (
        <div className="alert-item alert-info" style={{ marginBottom: 12 }}>
          <i className="ti ti-users" style={{ fontSize: 18 }}></i>
          <div className="alert-desc">
            {preview.loading ? t('composer.recipientPreview.loading')
              : preview.total == null ? t('composer.recipientPreview.none')
              : t('composer.recipientPreview.total', { count: preview.total })}
          </div>
        </div>
      )}

      {isPublished && (
        <label className="form-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={notifyOnUpdate} onChange={e => setNotifyOnUpdate(e.target.checked)} /> {t('composer.notifyOnUpdate')}
        </label>
      )}

      {!isLocked && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {isPublished ? (
            <button className={'btn-primary' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handleSaveEdits}>
              {saving ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('composer.actions.saveChanges')}</>}
            </button>
          ) : (
            <>
              <button className={'btn-sm' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handleSaveDraft}>
                {saving ? <span className="spinner"></span> : <><i className="ti ti-device-floppy"></i> {t('composer.actions.saveDraft')}</>}
              </button>
              {!showSchedule && (
                <button className="btn-sm" disabled={saving} onClick={() => setShowSchedule(true)}>
                  <i className="ti ti-calendar-time"></i> {t('composer.actions.schedule')}
                </button>
              )}
              {showSchedule && (
                <>
                  <input type="datetime-local" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
                  <button className={'btn-sm' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handleConfirmSchedule}>
                    {t('composer.actions.confirmSchedule')}
                  </button>
                </>
              )}
              <button className={'btn-primary' + (saving ? ' btn-loading' : '')} disabled={saving} onClick={handlePublishNow}>
                {saving ? <span className="spinner"></span> : <><i className="ti ti-send"></i> {t('composer.actions.sendNow')}</>}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
