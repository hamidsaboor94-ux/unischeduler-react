import { useTranslation } from 'react-i18next';
import { useModal } from '../context/ModalContext.jsx';
import { useAutoResolve } from '../hooks/useSchedulingActions.js';

/** Port of conflictItemHtml() + actionsFor() + focusIssue() — one alert card per issue, shared by
    the Conflicts page and the Dashboard's Active Conflicts panel. */
export default function ConflictItem({ issue, severity }) {
  const { t } = useTranslation('admin');
  const { openModal } = useModal();
  const { autoResolveAll } = useAutoResolve();

  const { cls, icon, pillCls, pillLabel } = {
    critical: {
      cls: 'alert-danger',
      icon: issue.type === 'instructor-double-booking' ? 'ti-user-exclamation'
        : issue.type === 'duplicate-slot' ? 'ti-copy' : 'ti-building',
      pillCls: 'pill-red', pillLabel: t('admin:conflictItem.severity.critical'),
    },
    warning: {
      cls: 'alert-warn',
      icon: issue.type === 'capacity' ? 'ti-users' : 'ti-user-exclamation',
      pillCls: 'pill-amber', pillLabel: t('admin:conflictItem.severity.warning'),
    },
    notice: { cls: 'alert-info', icon: 'ti-info-circle', pillCls: 'pill-blue', pillLabel: t('admin:conflictItem.severity.notice') },
  }[severity];

  const hasDetailView = issue.type === 'room-double-booking' || issue.type === 'instructor-double-booking'
    || issue.type === 'duplicate-slot'
    || issue.type === 'moved-session-room-clash' || issue.type === 'moved-session-instructor-clash';

  function focusIssue() {
    if (hasDetailView) openModal('conflict-detail', null, { issue });
  }

  function stop(e, fn) { e.stopPropagation(); fn(); }

  let actions = null;
  if (issue.type === 'room-double-booking') {
    actions = <>
      <button className="btn-sm" onClick={e => stop(e, autoResolveAll)}>{t('admin:conflictItem.actions.suggestFix')}</button>
      <button className="btn-sm" onClick={e => stop(e, () => openModal('conflict-detail', null, { issue }))}>{t('admin:conflictItem.actions.viewDetails')}</button>
    </>;
  } else if (issue.type === 'instructor-double-booking') {
    actions = <>
      <button className="btn-sm" onClick={e => stop(e, autoResolveAll)}>{t('admin:conflictItem.actions.suggestFix')}</button>
      <button className="btn-sm" onClick={e => stop(e, () => openModal('conflict-detail', null, { issue }))}>{t('admin:conflictItem.actions.viewDetails')}</button>
    </>;
  } else if (issue.type === 'moved-session-room-clash' || issue.type === 'moved-session-instructor-clash') {
    // No auto-resolve for one-off moves — the fix is picking a different
    // date/time/room for that single session, which is a human call.
    actions = <button className="btn-sm" onClick={e => stop(e, () => openModal('conflict-detail', null, { issue }))}>{t('admin:conflictItem.actions.viewDetails')}</button>;
  } else if (issue.type === 'duplicate-slot') {
    // No auto-resolve here either — deciding which of the two overlapping entries is the
    // real one (and deleting the other) needs a human, not an automatic move.
    actions = <button className="btn-sm" onClick={e => stop(e, () => openModal('conflict-detail', null, { issue }))}>{t('admin:conflictItem.actions.viewDetails')}</button>;
  } else if (issue.type === 'exam-clash') {
    actions = <>
      <button className="btn-sm" onClick={e => stop(e, autoResolveAll)}>{t('admin:conflictItem.actions.reschedule')}</button>
      <button className="btn-sm" onClick={e => stop(e, () => openModal('studentList', null, { studentIds: issue.studentIds }))}>{t('admin:conflictItem.actions.viewStudents')}</button>
    </>;
  } else if (issue.type === 'capacity') {
    actions = <button className="btn-sm" onClick={e => stop(e, autoResolveAll)}>{t('admin:conflictItem.actions.findLargerRoom')}</button>;
  } else if (issue.type === 'invigilator-shortage') {
    actions = <button className="btn-sm" onClick={e => stop(e, autoResolveAll)}>{t('admin:conflictItem.actions.assignInvigilators')}</button>;
  }

  return (
    <div className={'alert-item ' + cls} onClick={focusIssue}>
      <i className={'ti ' + icon} style={{ fontSize: 18 }}></i>
      <div style={{ flex: 1 }}>
        <div className="alert-title">{issue.title}</div>
        <div className="alert-desc">{issue.desc}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>{actions}</div>
      </div>
      <span className={'pill ' + pillCls}>{pillLabel}</span>
    </div>
  );
}
