/**
 * Electron main process for UniScheduler.
 *
 * Runs in one of two modes, chosen once via a first-launch setup window and
 * persisted in server-config.cjs's config file:
 *
 *  - "embedded" (the historical default, single-PC use): starts the Express/
 *    SQLite backend *in this process* (Electron ships its own Node.js
 *    runtime, so end users don't need Node installed) on a random localhost
 *    port, with its database under this install's AppData folder.
 *  - "client" (shared/LAN use): starts no local backend at all — connects to
 *    a UniScheduler server already running elsewhere on the network, so this
 *    app and every other device (desktop or website) read/write the same
 *    database.
 *
 * Either way the built React app from dist/ opens in a desktop window and
 * talks to whichever API base preload.cjs hands it.
 *
 * The embedded backend's source is copied into electron/backend/ by
 * scripts/copy-backend.mjs — run that (or `npm run dist`) after changing
 * anything under "uni scheduling/api/src".
 */
const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { setupAutoUpdates } = require('./updater.cjs');
const { ensureLicensed } = require('./licensing.cjs');
const { ensureServerConfig, pingServer } = require('./server-config.cjs');

// When unpackaged, prefer a running Vite dev server over the static dist/
// build if one happens to be up (`npm run dev` in another terminal) — gives
// hot-reload for UI changes instead of needing a rebuild + relaunch for every
// tweak. Never used in a packaged install (app.isPackaged short-circuits it).
const DEV_SERVER_URL = 'http://localhost:5173';

function probeDevServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 400 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Only one running copy makes sense: in embedded mode a second instance would
// fight over the SQLite file and (before the port-0 change) a fixed port;
// in client mode there's simply no reason to run twice. Re-launching just
// focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  const userDataDir = app.getPath('userData'); // e.g. C:\Users\<you>\AppData\Roaming\UniScheduler
  fs.mkdirSync(userDataDir, { recursive: true });

  let win = null;

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    // License gate before anything else. Shows the activation window on the
    // first launch; afterwards the stored (and re-verified) license.json in
    // userData means this resolves instantly with no UI.
    let activation;
    try {
      activation = await ensureLicensed(userDataDir);
    } catch (err) {
      dialog.showErrorBox('UniScheduler could not start', String(err && err.message || err));
      app.exit(1);
      return;
    }
    if (!activation) {
      // Activation window closed without a valid key — nothing to run.
      app.quit();
      return;
    }

    // Embedded vs. client mode. Shows the setup window on the first launch
    // only; afterwards server-config.json in userData means this resolves
    // instantly with no UI, same as licensing above.
    let serverSetup;
    try {
      serverSetup = await ensureServerConfig(userDataDir);
    } catch (err) {
      dialog.showErrorBox('UniScheduler could not start', String(err && err.message || err));
      app.exit(1);
      return;
    }
    if (!serverSetup) {
      // Setup window closed without a choice being made — nothing to run.
      app.quit();
      return;
    }

    let apiBase;
    try {
      apiBase = serverSetup.config.mode === 'client'
        ? await startClientMode(serverSetup.config.serverUrl)
        : await startEmbeddedBackend(userDataDir);
    } catch (err) {
      dialog.showErrorBox(
        'UniScheduler could not start',
        serverSetup.config.mode === 'client'
          ? `Could not connect to the shared server at ${serverSetup.config.serverUrl}:\n\n${err && err.message || err}\n\nDelete server-config.json in this app's data folder and relaunch to reconfigure.`
          : `The built-in server failed to start:\n\n${err && err.stack || err}`
      );
      app.exit(1);
      return;
    }

    const devServerUrl = app.isPackaged ? null : (await probeDevServer(DEV_SERVER_URL) ? DEV_SERVER_URL : null);
    win = createWindow(apiBase, devServerUrl);
    // Close the activation/setup windows only now that the main window
    // exists, so the window-all-closed -> quit handler can't fire in between.
    if (activation.activationWindow && !activation.activationWindow.isDestroyed()) {
      activation.activationWindow.close();
    }
    if (serverSetup.setupWindow && !serverSetup.setupWindow.isDestroyed()) {
      serverSetup.setupWindow.close();
    }
    setupAutoUpdates(() => win);
  });
}

/** Client mode: no local server or database at all — just confirm the configured shared
    server is actually reachable right now (it may have been rebooted, moved, or blocked by
    a firewall since it was configured) and hand its address to the renderer. */
async function startClientMode(serverUrl) {
  const base = await pingServer(serverUrl);
  console.log(`UniScheduler connected to shared server at ${base}`);
  return `${base}/api`;
}

async function startEmbeddedBackend(userDataDir) {
  // Point the backend's SQLite file at the per-user app-data directory. This
  // must happen BEFORE backend/db.js is required (it reads DB_PATH at load
  // time). Installing under Program Files gives a read-only install dir, and
  // the app.asar archive isn't writable either — AppData is the one place
  // that persists safely across launches and app updates.
  process.env.DB_PATH = path.join(userDataDir, 'database.sqlite');

  // A stable, per-install random JWT secret (persisted next to the DB) so
  // logins keep working across restarts without shipping a hardcoded secret.
  process.env.JWT_SECRET = loadOrCreateJwtSecret(path.join(userDataDir, 'jwt-secret'));

  const { init, get, run, nextIdNumberForRole } = require('./backend/db');
  await init();
  await ensureDefaultAdmin(get, run, nextIdNumberForRole);

  const api = require('./backend/app');
  const port = await new Promise((resolve, reject) => {
    // 127.0.0.1, not 0.0.0.0 — this database is for this desktop app only,
    // so don't expose it to the local network. (Client mode is how a
    // network-shared setup works instead — see startClientMode above.)
    const server = api.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
  console.log(`UniScheduler backend listening on http://127.0.0.1:${port}`);
  return `http://127.0.0.1:${port}/api`;
}

/**
 * A fresh install starts with an empty database and the app has no public
 * self-registration, so seed one admin account the user can log in with.
 * mustChangePassword=1 forces them to pick a real password on first login.
 * Only runs when the users table is completely empty — it never touches an
 * existing install's accounts.
 */
async function ensureDefaultAdmin(get, run, nextIdNumberForRole) {
  const anyUser = await get('SELECT id FROM users LIMIT 1');
  if (anyUser) return;
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync('ChangeMe123', 8);
  const idNumber = await nextIdNumberForRole('admin');
  await run(
    'INSERT INTO users (name, email, passwordHash, role, mustChangePassword, idNumber) VALUES (?, ?, ?, ?, 1, ?)',
    ['Administrator', 'admin@example.edu', passwordHash, 'admin', idNumber]
  );
  console.log('Seeded default admin account: admin@example.edu / ChangeMe123');
}

function createWindow(apiBase, devServerUrl) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // avoid a white flash; shown on ready-to-show below
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      // Documented way to hand a value to a sandboxed preload: it shows up in
      // the renderer's process.argv. URL-encoded since it may contain a
      // LAN address with a colon/slash.
      additionalArguments: [`--unischeduler-api-base=${encodeURIComponent(apiBase)}`]
    }
  });

  win.once('ready-to-show', () => win.show());

  // Any target="_blank" / window.open link goes to the user's real browser
  // instead of spawning another Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return win;
}

function loadOrCreateJwtSecret(file) {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch { /* first run — generate below */ }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, 'utf8');
  return secret;
}
