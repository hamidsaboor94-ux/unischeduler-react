/**
 * License key verification and first-launch activation for UniScheduler.
 *
 * Keys are Ed25519-signed (issued by scripts/make-license.mjs with the private
 * key in license-keys/, which never ships). This module only VERIFIES, using
 * license-public-key.pem baked into the build — no internet needed, ever.
 *
 * Key format:  UNISCHED1.<base64url payload>.<base64url signature>
 * Payload:     {"v":1,"school":"...","issued":"YYYY-MM-DD"}
 *
 * A valid activation is remembered in <userData>/license.json; the stored key
 * is re-verified on every launch, so editing that file by hand just brings the
 * activation screen back.
 */
const { BrowserWindow, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_PREFIX = 'UNISCHED1';

function publicKey() {
  const pemPath = path.join(__dirname, 'license-public-key.pem');
  if (!fs.existsSync(pemPath)) {
    throw new Error(
      'electron/license-public-key.pem is missing — run ' +
      '"node scripts/generate-license-keypair.mjs" once before building the app.'
    );
  }
  return fs.readFileSync(pemPath, 'utf8');
}

/** Returns the license payload ({ school, issued }) for a valid key, or null.
    Tolerates the whitespace/line breaks email clients love to add. */
function verifyLicenseKey(keyString) {
  try {
    const cleaned = String(keyString || '').replace(/\s+/g, '');
    const [prefix, payloadB64, sigB64] = cleaned.split('.');
    if (prefix !== KEY_PREFIX || !payloadB64 || !sigB64) return null;
    const payload = Buffer.from(payloadB64, 'base64url');
    const signature = Buffer.from(sigB64, 'base64url');
    if (!crypto.verify(null, payload, publicKey(), signature)) return null; // Ed25519
    const data = JSON.parse(payload.toString('utf8'));
    if (data.v !== 1 || !data.school) return null;
    return { school: data.school, issued: data.issued, key: cleaned };
  } catch {
    return null;
  }
}

function licenseFile(userDataDir) {
  return path.join(userDataDir, 'license.json');
}

/** The stored activation, re-verified — or null if absent/tampered. */
function loadStoredLicense(userDataDir) {
  try {
    const stored = JSON.parse(fs.readFileSync(licenseFile(userDataDir), 'utf8'));
    return verifyLicenseKey(stored.key);
  } catch {
    return null;
  }
}

function saveLicense(userDataDir, license) {
  fs.writeFileSync(
    licenseFile(userDataDir),
    JSON.stringify({ key: license.key, school: license.school, activatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

/**
 * Resolves with the active license, showing the activation window first if
 * this install hasn't been activated yet. Resolves null if the user closes
 * the window without activating (caller should quit).
 *
 * On success the activation window is intentionally left open (it shows
 * "starting…") — call .close() on the returned window after the main window
 * exists, so Electron's window-all-closed quit never fires in the gap.
 */
function ensureLicensed(userDataDir) {
  const existing = loadStoredLicense(userDataDir);
  if (existing) return Promise.resolve({ license: existing, activationWindow: null });

  return new Promise((resolve) => {
    let activated = false;

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
        preload: path.join(__dirname, 'activation-preload.cjs')
      }
    });

    ipcMain.handle('license:activate', (event, keyString) => {
      const license = verifyLicenseKey(keyString);
      if (!license) {
        return { ok: false, error: 'That license key is not valid. Check for missing characters and try pasting it again.' };
      }
      saveLicense(userDataDir, license);
      activated = true;
      resolve({ license, activationWindow: win });
      return { ok: true, school: license.school };
    });

    win.on('closed', () => {
      ipcMain.removeHandler('license:activate');
      if (!activated) resolve(null);
    });

    win.loadFile(path.join(__dirname, 'activation.html'));
  });
}

module.exports = { verifyLicenseKey, loadStoredLicense, ensureLicensed };
