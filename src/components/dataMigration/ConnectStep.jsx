import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  uploadMigrationSource, fetchMigrationConnections, saveMigrationConnection,
  testMigrationConnection, testSavedMigrationConnection, createMigration,
} from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';

const FILE_SOURCE_TYPES = new Set(['sqlite', 'csv', 'excel']);
const FILE_ACCEPT = { sqlite: '.sqlite,.db,.sqlite3', csv: '.csv', excel: '.xlsx,.xls' };
const DEFAULT_PORT = { mysql: 3306, postgres: 5432, mssql: 1433 };

function FileConnect({ sourceType, onMigrationCreated }) {
  const { t } = useTranslation('admin');
  const { toast } = useToast();
  const fileRef = useRef(null);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState(null);
  const { run, loading } = useAsyncAction();

  async function submit() {
    if (!file) return;
    try {
      const created = await run(uploadMigrationSource(file, { label: label.trim(), sourceType }));
      onMigrationCreated(created.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div>
      <div className="form-row">
        <div className="form-label">{t('admin:dataMigrationPage.connect.label')}</div>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder={t('admin:dataMigrationPage.connect.labelPlaceholder')} />
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <div className="form-label">{t('admin:dataMigrationPage.connect.file')}</div>
        <input ref={fileRef} type="file" accept={FILE_ACCEPT[sourceType]} onChange={e => setFile(e.target.files[0] || null)} />
      </div>
      <button className={'btn-primary' + (loading ? ' btn-loading' : '')} style={{ marginTop: 14 }} disabled={!file || loading} onClick={submit}>
        {loading ? <span className="spinner"></span> : <><i className="ti ti-upload" aria-hidden="true"></i> {t('admin:dataMigrationPage.connect.uploadButton')}</>}
      </button>
    </div>
  );
}

function DbConnect({ sourceType, onMigrationCreated }) {
  const { t } = useTranslation('admin');
  const { toast } = useToast();
  const [saved, setSaved] = useState([]);
  const [savedId, setSavedId] = useState('');
  const [label, setLabel] = useState('');
  const [config, setConfig] = useState({ host: '', port: DEFAULT_PORT[sourceType] || '', database: '', user: '' });
  const [password, setPassword] = useState('');
  const [testResult, setTestResult] = useState(null);
  const { run: runTest, loading: testing } = useAsyncAction();
  const { run: runSubmit, loading: submitting } = useAsyncAction();

  useEffect(() => {
    fetchMigrationConnections().then(rows => setSaved(rows.filter(c => c.sourceType === sourceType)));
  }, [sourceType]);

  function field(key) {
    return { value: config[key] ?? '', onChange: e => setConfig(c => ({ ...c, [key]: e.target.value })) };
  }

  async function testNew() {
    setTestResult(null);
    const result = await runTest(testMigrationConnection(sourceType, { ...config, password }));
    setTestResult(result);
  }

  async function useSaved() {
    try {
      const result = await runTest(testSavedMigrationConnection(Number(savedId)));
      setTestResult(result);
      if (!result.ok) return;
      const created = await runSubmit(createMigration({ label: label.trim(), connectionId: Number(savedId) }));
      onMigrationCreated(created.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function saveAndContinue() {
    try {
      const conn = await runSubmit(saveMigrationConnection({ label: label.trim() || config.host, sourceType, config, password }));
      const created = await runSubmit(createMigration({ label: label.trim(), connectionId: conn.id }));
      onMigrationCreated(created.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div>
      {saved.length > 0 && (
        <div className="panel" style={{ padding: 14, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>{t('admin:dataMigrationPage.connect.savedConnections')}</h4>
          <div className="form-row">
            <select value={savedId} onChange={e => setSavedId(e.target.value)}>
              <option value="">{t('admin:dataMigrationPage.connect.choosePlaceholder')}</option>
              {saved.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <button className="btn-sm" disabled={!savedId || testing || submitting} onClick={useSaved}>
              {testing || submitting ? <span className="spinner"></span> : t('admin:dataMigrationPage.connect.useConnection')}
            </button>
          </div>
        </div>
      )}

      <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>{t('admin:dataMigrationPage.connect.newConnection')}</h4>
      <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.connect.label')}</div><input type="text" value={label} onChange={e => setLabel(e.target.value)} /></div>
      <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.connect.host')}</div><input type="text" {...field('host')} /></div>
      <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.connect.port')}</div><input type="number" {...field('port')} /></div>
      <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.connect.database')}</div><input type="text" {...field('database')} /></div>
      <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.connect.user')}</div><input type="text" {...field('user')} /></div>
      <div className="form-row"><div className="form-label">{t('admin:dataMigrationPage.connect.password')}</div><input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn-sm" disabled={testing} onClick={testNew}>
          {testing ? <span className="spinner"></span> : t('admin:dataMigrationPage.connect.testButton')}
        </button>
        <button className={'btn-primary' + (submitting ? ' btn-loading' : '')} disabled={submitting || !config.host} onClick={saveAndContinue}>
          {submitting ? <span className="spinner"></span> : t('admin:dataMigrationPage.connect.saveAndContinue')}
        </button>
      </div>
      {testResult && (
        <p className="field-hint" style={{ marginTop: 10, color: testResult.ok ? 'var(--success, green)' : 'var(--danger)' }}>
          {testResult.ok ? t('admin:dataMigrationPage.connect.testOk') : `${t('admin:dataMigrationPage.connect.testFailed')}: ${testResult.error}`}
        </p>
      )}
    </div>
  );
}

export default function ConnectStep({ sourceType, onMigrationCreated, onBack }) {
  const { t } = useTranslation('admin');
  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{t('admin:dataMigrationPage.connect.title')}</h3>
      {FILE_SOURCE_TYPES.has(sourceType)
        ? <FileConnect sourceType={sourceType} onMigrationCreated={onMigrationCreated} />
        : <DbConnect sourceType={sourceType} onMigrationCreated={onMigrationCreated} />}
      <button className="btn-sm" style={{ marginTop: 14 }} onClick={onBack}>
        <i className="ti ti-arrow-left" aria-hidden="true"></i> {t('common:actions.back')}
      </button>
    </div>
  );
}
