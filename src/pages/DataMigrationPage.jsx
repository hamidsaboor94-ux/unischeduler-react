import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { fetchMigration, fetchMigrations } from '../api.js';
import { useNavigation } from '../context/NavigationContext.jsx';
import SelectSourceStep from '../components/dataMigration/SelectSourceStep.jsx';
import ConnectStep from '../components/dataMigration/ConnectStep.jsx';
import DiscoverStep from '../components/dataMigration/DiscoverStep.jsx';
import MappingStep from '../components/dataMigration/MappingStep.jsx';
import ValidateStep from '../components/dataMigration/ValidateStep.jsx';
import DryRunStep from '../components/dataMigration/DryRunStep.jsx';
import ImportStep from '../components/dataMigration/ImportStep.jsx';
import ReportStep from '../components/dataMigration/ReportStep.jsx';

const STEPS = ['selectSource', 'connect', 'discover', 'map', 'validate', 'dryRun', 'import', 'report'];

// Where to resume the wizard when a past migration is picked from history — status is the durable
// server-side record of wizard progress, local `step` state is only the source of truth while
// actively moving forward through a brand-new run.
const STATUS_TO_STEP = {
  draft: 2, discovering: 2, discovered: 3, mapped: 4, validated: 5,
  dry_run: 6, running: 6, completed: 7, failed: 7, cancelled: 7, rolled_back: 7,
};

const STATUS_PILL = {
  draft: 'pill-gray', discovering: 'pill-blue', discovered: 'pill-blue', mapped: 'pill-blue',
  validated: 'pill-blue', dry_run: 'pill-amber', running: 'pill-amber', completed: 'pill-green',
  failed: 'pill-red', cancelled: 'pill-red', rolled_back: 'pill-gray',
};

export default function DataMigrationPage() {
  const { t } = useTranslation('admin');
  const { activeSection } = useNavigation();
  const [migrationId, setMigrationId] = useState(null);
  const [step, setStep] = useState(0);
  const [sourceType, setSourceType] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(true);

  async function reloadHistory() {
    setHistoryLoading(true);
    try {
      setHistory(await fetchMigrations());
    } finally {
      setHistoryLoading(false);
    }
  }

  // Hidden sections stay mounted, so defer protected work until this page is opened.
  useEffect(() => { if (activeSection === 'data-migration') reloadHistory(); }, [activeSection]);

  function startNew() {
    setMigrationId(null);
    setSourceType(null);
    setStep(0);
    setShowHistory(false);
  }

  async function resume(row) {
    const full = await fetchMigration(row.id);
    setMigrationId(row.id);
    setSourceType(full.sourceType);
    setStep(STATUS_TO_STEP[row.status] ?? 7);
    setShowHistory(false);
  }

  function goBackToHistory() {
    setShowHistory(true);
    reloadHistory();
  }

  const stepProps = {
    migrationId,
    sourceType,
    onSourceTypeSelected: (type) => { setSourceType(type); setStep(1); },
    onMigrationCreated: (id) => { setMigrationId(id); setStep(2); },
    onDiscovered: () => setStep(3),
    onMapped: () => setStep(4),
    onValidated: () => setStep(5),
    onDryRunComplete: () => setStep(6),
    onImportComplete: () => setStep(7),
    onDone: goBackToHistory,
    onBack: () => setStep(s => Math.max(0, s - 1)),
  };

  return (
    <Section name="data-migration">
      <div className="topbar">
        <i className="ti ti-database-import" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('admin:dataMigrationPage.title')}</h2>
        <div className="topbar-actions">
          {!showHistory && (
            <button className="btn-sm" onClick={goBackToHistory}>
              <i className="ti ti-list" aria-hidden="true"></i> {t('admin:dataMigrationPage.viewHistory')}
            </button>
          )}
          <button className="btn-primary" onClick={startNew}>
            <i className="ti ti-plus" aria-hidden="true"></i> {t('admin:dataMigrationPage.newMigration')}
          </button>
        </div>
      </div>
      <div id="content">
        <p className="field-hint" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('admin:dataMigrationPage.hint')}
        </p>

        {showHistory ? (
          <div className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('admin:dataMigrationPage.history.label')}</th>
                  <th>{t('admin:dataMigrationPage.history.source')}</th>
                  <th>{t('admin:dataMigrationPage.history.status')}</th>
                  <th>{t('admin:dataMigrationPage.history.rows')}</th>
                  <th>{t('admin:dataMigrationPage.history.created')}</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  <tr><td colSpan={5} className="field-hint" style={{ padding: 14 }}>{t('common:loading')}</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={5} className="field-hint" style={{ padding: 14 }}>{t('admin:dataMigrationPage.history.empty')}</td></tr>
                ) : history.map(m => (
                  <tr key={m.id} onClick={() => resume(m)} style={{ cursor: 'pointer' }}>
                    <td>{m.label || `#${m.id}`}</td>
                    <td>{m.sourceType}</td>
                    <td><span className={'pill ' + (STATUS_PILL[m.status] || 'pill-gray')}>{m.status}</span></td>
                    <td>{m.insertedRows ?? 0} / {m.totalRows ?? '—'}</td>
                    <td>{m.createdAt ? new Date(m.createdAt + 'Z').toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <ol className="migration-step-indicator">
              {STEPS.map((key, i) => (
                <li key={key} className={i === step ? 'active' : i < step ? 'done' : ''}>
                  <span className="migration-step-number">{i < step ? <i className="ti ti-check" aria-hidden="true"></i> : i + 1}</span>
                  {t(`admin:dataMigrationPage.steps.${key}`)}
                </li>
              ))}
            </ol>

            <div className="panel" style={{ padding: 18 }}>
              {step === 0 && <SelectSourceStep {...stepProps} />}
              {step === 1 && <ConnectStep {...stepProps} />}
              {step === 2 && <DiscoverStep {...stepProps} />}
              {step === 3 && <MappingStep {...stepProps} />}
              {step === 4 && <ValidateStep {...stepProps} />}
              {step === 5 && <DryRunStep {...stepProps} />}
              {step === 6 && <ImportStep {...stepProps} />}
              {step === 7 && <ReportStep {...stepProps} />}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
