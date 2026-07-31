import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchPendingApprovals, decideApprovalRequest } from '../api.js';
import { fmtLongDate } from '../utils.js';

/** Per-type payload summary — the one place a new request type (leave, readmission, graduation,
    ...) plugs into this generic reviewer queue. 'appeal' is the only registered type today; a
    type with no entry here still shows (fallback below), just without a tailored summary. */
const TYPE_SUMMARY = {
  appeal: (payload) => `${payload?.courseCode} — ${payload?.courseName}`,
};

/** A reviewer's pending queue across every registered approval-chain request type (see
    api/src/approvalEngine.js) — faculty and registrar both land here, each seeing only the
    requests currently awaiting their own role's step (server-scoped, not filtered client-side).
    A new flow type needs no new page: it just starts appearing here once registered. */
export default function ApprovalsPage() {
  const { t } = useTranslation(['approvals', 'common']);
  const { activeSection } = useNavigation();
  const { toast } = useToast();

  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      setPending(await fetchPendingApprovals());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (activeSection === 'approvals') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  async function handleDecide(id, decision) {
    setBusyId(id);
    try {
      await decideApprovalRequest(id, decision, (notes[id] || '').trim() || undefined);
      toast(t(`queue.decided.${decision}`));
      setNotes(n => { const next = { ...n }; delete next[id]; return next; });
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Section name="approvals">
      <div className="topbar">
        <i className="ti ti-checklist" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('queue.title')}</h2>
      </div>
      <div id="content">
        <div className="panel">
          <div className="panel-header">
            <div><div className="panel-title">{t('queue.panelTitle')}</div><div className="panel-subtitle">{t('queue.panelHint')}</div></div>
          </div>
          {loading && <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>}
          {!loading && pending.length === 0 && <div className="empty-state">{t('queue.empty')}</div>}
          {!loading && pending.map(r => {
            const step = r.chain.find(s => s.stepOrder === r.currentStepOrder);
            const summarize = TYPE_SUMMARY[r.type];
            const busy = busyId === r.id;
            return (
              <div key={r.id} className="approval-card">
                <div className="approval-card-header">
                  <div>
                    <strong>{summarize ? summarize(r.payload) : t(`type.${r.type}`, r.type)}</strong>
                    <div className="field-hint">
                      {t('queue.from', { name: r.requesterName || t('common:notApplicable') })} · {fmtLongDate(r.createdAt?.slice(0, 10))}
                      {step?.label && ` · ${step.label}`}
                    </div>
                  </div>
                </div>
                {r.payload?.reason && <div className="field-hint" style={{ marginBottom: 8 }}>{r.payload.reason}</div>}

                {r.decisions.length > 0 && (
                  <ul className="approval-timeline">
                    {r.decisions.map(d => (
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

                <div className="form-row" style={{ marginTop: 8 }}>
                  <textarea rows={2} placeholder={t('queue.notePlaceholder')} value={notes[r.id] || ''}
                    onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={'btn-primary' + (busy ? ' btn-loading' : '')} disabled={busy} onClick={() => handleDecide(r.id, 'approve')}>
                    {busy ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('queue.actions.approve')}</>}
                  </button>
                  <button className="btn-sm" disabled={busy} onClick={() => handleDecide(r.id, 'return')}>
                    <i className="ti ti-corner-up-left"></i> {t('queue.actions.return')}
                  </button>
                  <button className="btn-sm danger" disabled={busy} onClick={() => handleDecide(r.id, 'reject')}>
                    <i className="ti ti-x"></i> {t('queue.actions.reject')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
