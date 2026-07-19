import { useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { apiDownload, apiUpload } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useModal } from '../context/ModalContext.jsx';

export default function BackupPage() {
  const { t } = useTranslation('admin');
  const { toast } = useToast();
  const { confirmAction } = useModal();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function exportBackup() {
    setBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await apiDownload('/backup/export', `unischeduler-backup-${stamp}.sqlite`);
      toast(t('admin:backupPage.toast.exported'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function pickRestoreFile(e) {
    const file = e.target.files[0];
    e.target.value = ''; // so cancelling the confirm and re-picking the same file still fires onChange
    if (!file) return;
    confirmAction(
      t('admin:backupPage.confirmRestore.message', { fileName: file.name }),
      () => restoreBackup(file),
      t('admin:backupPage.confirmRestore.label')
    );
  }

  async function restoreBackup(file) {
    setBusy(true);
    try {
      await apiUpload('/backup/restore', 'backup', file);
      toast(t('admin:backupPage.toast.restored'));
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Section name="backup">
      <div className="topbar">
        <i className="ti ti-database-export" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('admin:backupPage.title')}</h2>
      </div>
      <div id="content">
        <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>
            <i className="ti ti-database-export" aria-hidden="true"></i> {t('admin:backupPage.export.title')}
          </h3>
          <p className="field-hint" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
            {t('admin:backupPage.export.hint')}
          </p>
          <button className="btn-primary" disabled={busy} onClick={exportBackup}>
            <i className="ti ti-download" aria-hidden="true"></i> {t('admin:backupPage.export.button')}
          </button>
        </div>

        <div className="panel" style={{ padding: 18 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>
            <i className="ti ti-database-import" aria-hidden="true"></i> {t('admin:backupPage.restore.title')}
          </h3>
          <p className="field-hint" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
            <Trans i18nKey="admin:backupPage.restore.hint" components={{ strong: <strong /> }} />
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".sqlite,.db,.sqlite3,.backup"
            style={{ display: 'none' }}
            onChange={pickRestoreFile}
          />
          <button className="btn-sm" disabled={busy} onClick={() => fileRef.current.click()}>
            <i className="ti ti-upload" aria-hidden="true"></i> {t('admin:backupPage.restore.chooseButton')}
          </button>
        </div>
      </div>
    </Section>
  );
}
