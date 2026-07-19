/**
 * ONE-TIME setup for the license key system. Generates an Ed25519 keypair:
 *
 *   license-keys/private.pem   -- YOUR SIGNING KEY. Never share it, never copy
 *                                 it into electron/ or dist/. Anyone who has
 *                                 this file can mint valid license keys.
 *                                 BACK IT UP somewhere safe: if you lose it,
 *                                 you cannot issue keys that old installs
 *                                 accept (you'd have to ship an update with a
 *                                 new public key).
 *
 *   electron/license-public-key.pem -- ships inside the app; used only to
 *                                 VERIFY keys. Harmless to distribute.
 *
 * Refuses to overwrite an existing private key (that would orphan every key
 * you've already sold). Delete license-keys/private.pem yourself if you truly
 * want to start over.
 *
 * Usage: node scripts/generate-license-keypair.mjs
 */
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const privatePath = path.join(root, 'license-keys', 'private.pem');
const publicPath = path.join(root, 'electron', 'license-public-key.pem');

if (fs.existsSync(privatePath)) {
  console.error(`A private key already exists at ${privatePath} — refusing to overwrite it.`);
  console.error('Every license key you have already issued is signed by that key.');
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

fs.mkdirSync(path.dirname(privatePath), { recursive: true });
fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf8');
fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), 'utf8');

console.log(`Private signing key : ${privatePath}   <-- keep secret, BACK THIS UP`);
console.log(`Public verify key   : ${publicPath}   (ships inside the app)`);
console.log('\nNext: issue a key with  node scripts/make-license.mjs "School Name"');
