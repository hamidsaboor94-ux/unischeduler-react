import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { submitApprovalRequest, fetchMyApprovalRequests, cancelApprovalRequest, resubmitApprovalRequest } from '../api.js';
import { termName, fmtLongDate } from '../utils.js';

const STATUS_PILL = { 'In Review': 'pill-amber', Returned: 'pill-amber', Approved: 'pill-green', Rejected: 'pill-red', Cancelled: 'pill-gray' };
const CANCELLABLE_STATUSES = new Set(['In Review', 'Returned']);

/** A student's own submitted academic appeals — the first request type registered on the generic
    approval-chain engine (api/src/approvalEngine.js). Submits directly via the type-agnostic
    POST /approvals ({type:'appeal', payload}); everything shown here (chain, decisions, status)
    comes back from the same engine, not an appeals-specific endpoint. */
export default function MyAppealsPage() {
  const { t } = useTranslation(['approvals', 'common']);
  const { currentUser, myEnrollments, terms } = useAppData();
  const { activeSection } = useNavigation();
  const { confirmAction } = useModal();
  const { toast } = useToast();

  const [appeals, setAppeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [courseId, setCourseId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resubmitDrafts, setResubmitDrafts] = useState({});

  async function refresh() {
    setLoading(true);
    try {
      const rows = await fetchMyApprovalRequests();
      setAppeals(rows.filter(r => r.type === 'appeal'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (activeSection === 'my-appeals' && currentUser.role === 'student') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, currentUser.role]);

  const appealableCourses = [...new Map(myEnrollments.map(e => [e.id, e])).values()];

  async function handleSubmit() {
    if (!courseId || !reason.trim()) { toast(t('mine.form.validationError'), 'error'); return; }
    setSubmitting(true);
    try {
      await submitApprovalRequest('appeal', { courseId: Number(courseId), reason: reason.trim() });
      toast(t('mine.form.submitted'));
      setCourseId(''); setReason('');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel(id) {
    confirmAction(t('mine.confirmCancel'), async () => {
      try { await cancelApprovalRequest(id); toast(t('mine.cancelled')); await refresh(); } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function handleResubmit(id) {
    const reasonDraft = (resubmitDrafts[id] || '').trim();
    if (!reasonDraft) { toast(t('mine.form.validationError'), 'error'); return; }
    try {
      const appeal = appeals.find(a => a.id === id);
      await resubmitApprovalRequest(id, { courseId: appeal.payload.courseId, reason: reasonDraft });
      toast(t('mine.resubmitted'));
      setResubmitDrafts(d => { const next = { ...d }; delete next[id]; return next; });
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <Section name="my-appeals">
      <div className="topbar">
        <i className="ti ti-gavel" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('mine.title')}</h2>
      </div>
      <div id="content">
        <div className="panel">
          <div className="panel-header"><div className="panel-title">{t('mine.form.title')}</div></div>
          <div className="form-row">
            <div className="form-label">{t('mine.form.course')}</div>
            <select value={courseId} onChange={e => setCourseId(e.target.value)}>
              <option value="">{t('mine.form.selectCourse')}</option>
              {appealableCourses.map(c => (
                <option key={c.id} value={c.id}>{c.code} — {c.name} ({termName(terms, c.termId)})</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-label">{t('mine.form.reason')}</div>
            <textarea rows={4} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('mine.form.reasonPlaceholder')} />
          </div>
          <button className={'btn-primary' + (submitting ? ' btn-loading' : '')} disabled={submitting} onClick={handleSubmit}>
            {submitting ? <span className="spinner"></span> : <><i className="ti ti-send"></i> {t('mine.form.submit')}</>}
          </button>
        </div>

        <div className="panel">
          <div className="panel-header"><div className="panel-title">{t('mine.list.title')}</div></div>
          {loading && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
          {!loading && appeals.length === 0 && <div className="field-hint" style={{ padding: 14 }}>{t('mine.list.empty')}</div>}
          {!loading && appeals.map(a => (
            <div key={a.id} className="approval-card">
              <div className="approval-card-header">
                <div>
                  <strong>{a.payload?.courseCode} — {a.payload?.courseName}</strong>
                  <div className="field-hint">{t('mine.list.submitted')}: {fmtLongDate(a.createdAt?.slice(0, 10))}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={'pill ' + (STATUS_PILL[a.status] || 'pill-gray')}>{t(`status.${a.status}`, a.status)}</span>
                  {CANCELLABLE_STATUSES.has(a.status) && (
                    <button className="icon-btn danger" title={t('mine.cancelAction')} aria-label={t('mine.cancelAction')} onClick={() => handleCancel(a.id)}>
                      <i className="ti ti-x" aria-hidden="true"></i>
                    </button>
                  )}
                </div>
              </div>
              <div className="field-hint" style={{ marginBottom: 8 }}>{a.payload?.reason}</div>

              {a.decisions.length > 0 && (
                <ul className="approval-timeline">
                  {a.decisions.map(d => (
                    <li key={d.id}>
                      <span className={'pill ' + (d.decision === 'approve' ? 'pill-green' : d.decision === 'reject' ? 'pill-red' : 'pill-amber')}>
                        {t(`decision.${d.decision}`)}
                      </span>
                      {' '}{d.reviewerName} — {fmtLongDate(d.createdAt?.slice(0, 10))}
                      {d.note && <div className="field-hint">{d.note}</div>}
                    </li>
                  ))}
                </ul>
              )}

              {a.status === 'Returned' && (
                <div className="form-row" style={{ marginTop: 8 }}>
                  <div className="form-label">{t('mine.resubmitLabel')}</div>
                  <textarea rows={3} value={resubmitDrafts[a.id] ?? a.payload?.reason ?? ''}
                    onChange={e => setResubmitDrafts(d => ({ ...d, [a.id]: e.target.value }))} />
                  <button className="btn-sm" style={{ marginTop: 6 }} onClick={() => handleResubmit(a.id)}>{t('mine.resubmitAction')}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
