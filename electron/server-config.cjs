/**
 * Where this install gets its backend/database from — either its own embedded
 * server (single-PC mode, the historical default) or a shared UniScheduler
 * server elsewhere on the network (so multiple desktop apps + the website all
 * read/write the same data).
 *
 * The choice is made once via a first-launch setup window and persisted to
 * <userData>/server-config.json; every later launch reads that file directly
 * with no UI. To reconfigure (switch modes, change the server address),
 * delete that file and relaunch.
 */
const { BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function configFile(userDataDir) {
  return path.join(userDataDir, 'server-config.json');
}

/** The stored choice, or null if this install has never been configured. */
function loadServerConfig(userDataDir) {
  try {
    const stored = JSON.parse(fs.readFileSync(configFile(userDataDir), 'utf8'));
    if (stored.mode === 'client' && stored.serverUrl) return { mode: 'client', serverUrl: stored.serverUrl };
    if (stored.mode === 'embedded') return { mode: 'embedded' };
  } catch { /* no config yet — first run */ }
  return null;
}

function saveServerConfig(userDataDir, config) {
  fs.writeFileSync(configFile(userDataDir), JSON.stringify(config, null, 2), 'utf8');
}

/** Confirms a candidate shared-server address is actually reachable and speaking the
    UniScheduler API, tolerating a bare "host:port" typed without a scheme. Returns the
    normalized base URL (no trailing slash, no "/api" suffix) on success. */
async function pingServer(rawUrl) {
  let base = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Enter a server address');
  if (!/^https?:\/\//i.test(base)) base = 'http://' + base;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(base + '/api/ping', { signal: controller.signal });
    if (!res.ok) throw new Error(`server responded with ${res.status}`);
    const body = await res.json().catch(() => null);
    if (!body || body.ok !== true) throw new Error('unexpected response from that address');
    return base;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('timed out — check the address and that the server is running');
    throw new Error(err.message || 'could not connect');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolves with { config, setupWindow } — config is { mode: 'embedded' } or
 * { mode: 'client', serverUrl }. setupWindow is the still-open window on a fresh choice
 * (caller closes it once the main window exists, same pattern as licensing's activation
 * window) or null when an existing config was reused with no UI shown at all.
 * Resolves null if the window is closed without a choice being made (caller should quit).
 */
function ensureServerConfig(userDataDir) {
  const existing = loadServerConfig(userDataDir);
  if (existing) return Promise.resolve({ config: existing, setupWindow: null });

  return new Promise((resolve) => {
    let chosen = false;

    const win = new BrowserWindow({
      width: 460,
      height: 560,
      resizable: false,
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', 'build', 'icon.ico'),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'server-setup-preload.cjs')
      }
    });

    ipcMain.handle('server-config:test', async (event, rawUrl) => {
      try {
        const base = await pingServer(rawUrl);
        return { ok: true, base };
      } catch (err) {
        return { ok: false, error: `Could not reach a UniScheduler server there (${err.message}).` };
      }
    });

    ipcMain.handle('server-config:save', (event, config) => {
      saveServerConfig(userDataDir, config);
      chosen = true;
      resolve({ config, setupWindow: win });
      return { ok: true };
    });

    win.on('closed', () => {
      ipcMain.removeHandler('server-config:test');
      ipcMain.removeHandler('server-config:save');
      if (!chosen) resolve(null);
    });

    win.loadFile(path.join(__dirname, 'server-setup.html'));
  });
}

module.exports = { loadServerConfig, saveServerConfig, ensureServerConfig, pingServer };
