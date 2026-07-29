import { useTranslation } from 'react-i18next';
import { initials } from '../utils.js';
import { Card } from './ui/Card.jsx';

const STATUS_META = {
  accepted: { pill: 'pill-green', labelKey: 'studentProfile:cards.statusAccepted' },
  pending: { pill: 'pill-amber', labelKey: 'studentProfile:cards.statusPending' },
  rejected: { pill: 'pill-red', labelKey: 'studentProfile:cards.statusRejected' },
};

function Row({ label, value, stack, accent }) {
  const missing = value === null || value === undefined || value === '';
  const cls = 'sdc-row-value' + (missing ? ' sdc-muted' : accent ? ' sdc-accent' : '');
  return (
    <div className={stack ? 'sdc-stack-row' : 'sdc-row'}>
      <span className="sdc-row-label">{label}</span>
      <span className={cls}>{missing ? '—' : value}</span>
    </div>
  );
}

export default function StudentDetailsCards({ student }) {
  const { t } = useTranslation(['studentProfile']);
  const s = student || {};
  const statusMeta = STATUS_META[s.status] || null;
  const subline = [s.program, s.semester].filter(Boolean).join(' · ');
  const documents = s.documents || [];

  return (
    <div className="sdc-wrap">
      <div className="panel sdc-header">
        <div className="sdc-avatar">{initials(s.fullName) || '—'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sdc-header-name">{s.fullName || '—'}</div>
          <div className="sdc-header-sub">{subline || '—'}</div>
        </div>
        <div className="sdc-header-pills">
          {statusMeta && <span className={'pill ' + statusMeta.pill}>{t(statusMeta.labelKey)}</span>}
          <span className="pill pill-blue">{t('studentProfile:cards.entryPill', { score: s.entryTestScore ?? '—' })}</span>
        </div>
      </div>

      <div className="sdc-grid">
        <Card variant="flat" size="compact" className="sdc-card">
          <div className="sdc-card-title">{t('studentProfile:cards.sections.personal')}</div>
          <Row label={t('studentProfile:cards.fields.father')} value={s.fatherName} />
          <Row label={t('studentProfile:cards.fields.grandfather')} value={s.grandfatherName} />
          <Row label={t('studentProfile:cards.fields.gender')} value={s.gender} />
          <Row label={t('studentProfile:cards.fields.born')} value={s.dob} />
          <Row label={t('studentProfile:cards.fields.nationality')} value={s.nationality} />
          <Row label={t('studentProfile:cards.fields.nationalId')} value={s.nationalId} />
          <Row label={t('studentProfile:cards.fields.passport')} value={s.passportNumber} />
        </Card>

        <Card variant="flat" size="compact" className="sdc-card">
          <div className="sdc-card-title">{t('studentProfile:cards.sections.contact')}</div>
          <Row label={t('studentProfile:cards.fields.mobile')} value={s.mobile} />
          <Row label={t('studentProfile:cards.fields.emergency')} value={s.emergencyContact} />
          <Row label={t('studentProfile:cards.fields.email')} value={s.email} stack accent />
          <div className="sdc-divider" />
          <div className="sdc-card-title">{t('studentProfile:cards.sections.address')}</div>
          <Row label={t('studentProfile:cards.fields.presentAddress')} value={s.presentAddress} stack />
          <Row label={t('studentProfile:cards.fields.permanentAddress')} value={s.permanentAddress} stack />
        </Card>

        <Card variant="flat" size="compact" className="sdc-card">
          <div className="sdc-card-title">{t('studentProfile:cards.sections.education')}</div>
          <Row label={t('studentProfile:cards.fields.previousSchool')} value={s.previousSchool} stack />
          <Row label={t('studentProfile:cards.fields.gradYear')} value={s.graduationYear} />
          <Row label={t('studentProfile:cards.fields.program')} value={s.program} />
          <Row label={t('studentProfile:cards.fields.entryTest')} value={s.entryTestScore} />
          <div className="sdc-divider" />
          <div className="sdc-card-title">{t('studentProfile:cards.sections.documents')}</div>
          {documents.length === 0 && <div className="sdc-doc-empty">{t('studentProfile:cards.noDocuments')}</div>}
          {documents.map((doc, i) => (
            <div className="sdc-doc-row" key={i}>
              <span className="sdc-row-label">{doc.type || '—'}</span>
              <span className="sdc-row-value">{doc.title || '—'}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
