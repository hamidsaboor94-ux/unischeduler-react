/**
 * Auto-update flow for the packaged desktop app, built on electron-updater.
 *
 * Design constraints (see package.json "build.publish" for where updates are
 * hosted):
 *  - Offline-first: the check runs in the background after launch, is skipped
 *    when there's no connectivity, and every failure is swallowed (logged to
 *    updater.log in the user-data dir) — the app must keep working fully
 *    offline, so no error dialogs, no blocking.
 *  - Nothing is downloaded or installed silently: the user is asked first
 *    ("Update now / Later"), and after the download they choose "Restart now"
 *    or "Later". "Later" still installs on next quit (autoInstallOnAppQuit),
 *    so updates are never disruptive mid-use.
 *
 * Test hook: UNISCHEDULER_UPDATER_AUTOACCEPT=1 answers both dialogs with
 * "yes" automatically (used by the scripted end-to-end update test; harmless
 * otherwise since it's never set for real users).
 */
const { app, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');

const CHECK_DELAY_MS = 5000;               // let the window open first
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // re-check during long-lived sessions

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), line); } catch { /* logging must never break the app */ }
  console.log(`[updater] ${message}`);
}

/**
 * Call once after the main window is created. getWindow() returns the current
 * BrowserWindow (or null) so dialogs can attach to it.
 */
function setupAutoUpdates(getWindow) {
  // In `electron .` development there is no app-update.yml and no installed
  // copy to update — skip entirely.
  if (!app.isPackaged) {
    log('Skipping auto-updates: app is not packaged (development run).');
    return;
  }

  const { autoUpdater } = require('electron-updater');
  const autoAccept = process.env.UNISCHEDULER_UPDATER_AUTOACCEPT === '1';

  autoUpdater.autoDownload = false;        // never download without asking
  autoUpdater.autoInstallOnAppQuit = true; // "Later" after download = install on next quit
  autoUpdater.logger = null;               // we do our own logging

  let promptedThisSession = false;

  autoUpdater.on('error', (err) => {
    // Expected offline / host-unreachable case included: log and move on.
    log(`Update check failed (app continues normally): ${err.message}`);
  });

  autoUpdater.on('update-available', async (info) => {
    log(`Update available: ${info.version} (current ${app.getVersion()})`);
    if (promptedThisSession) return; // don't nag on the 4-hourly re-check
    promptedThisSession = true;

    const choice = autoAccept ? 0 : dialog.showMessageBoxSync(getWindow(), {
      type: 'info',
      title: 'Update available',
      message: `A new version of UniScheduler is available (${info.version}).`,
      detail: 'The update downloads in the background — you can keep working while it does.',
      buttons: ['Update now', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice !== 0) {
      log('User chose "Later" — will offer again next launch.');
      return;
    }
    log('Downloading update…');
    autoUpdater.downloadUpdate().catch(err => log(`Download failed: ${err.message}`));
  });

  autoUpdater.on('update-not-available', () => log('No update available.'));

  autoUpdater.on('update-downloaded', (info) => {
    log(`Update ${info.version} downloaded.`);
    const choice = autoAccept ? 0 : dialog.showMessageBoxSync(getWindow(), {
      type: 'info',
      title: 'Update ready',
      message: `UniScheduler ${info.version} is ready to install.`,
      detail: 'Restart now to update, or keep working — it will install automatically the next time you close the app.',
      buttons: ['Restart to update', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice === 0) {
      log('Restarting to install update.');
      // isSilent=true (no installer UI), isForceRunAfter=true (reopen the app
      // after updating, since the user chose "restart", not "quit").
      autoUpdater.quitAndInstall(true, !autoAccept);
    } else {
      log('User chose "Later" — update installs on next app quit.');
    }
  });

  const check = () => {
    // net.isOnline() is a cheap local check (no request) — enough to skip
    // the attempt entirely on machines with no connectivity at all.
    if (!net.isOnline()) {
      log('Offline — skipping update check.');
      return;
    }
    log(`Checking for updates (current version ${app.getVersion()})…`);
    autoUpdater.checkForUpdates().catch(err => log(`Update check failed: ${err.message}`));
  };

  setTimeout(check, CHECK_DELAY_MS);
  setInterval(check, RECHECK_INTERVAL_MS);
}

module.exports = { setupAutoUpdates };
