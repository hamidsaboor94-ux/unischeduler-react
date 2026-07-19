/**
 * Issues a license key for one school. Run this once per sale:
 *
 *   node scripts/make-license.mjs "Kabul Polytechnic University"
 *
 * Prints a key like  UNISCHED1.eyJ2IjoxLCJzY2...  that you send to the school.
 * The key embeds the school's name and issue date, signed with your private
 * key (license-keys/private.pem) — the app verifies the signature with the
 * public key baked into the build, entirely offline.
 */
import { sign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const school = (process.argv[2] || '').trim();
if (!school) {
  console.error('Usage: node scripts/make-license.mjs "School Name"');
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const privatePath = path.join(root, 'license-keys', 'private.pem');
if (!fs.existsSync(privatePath)) {
  console.error(`No signing key at ${privatePath} — run  node scripts/generate-license-keypair.mjs  first.`);
  process.exit(1);
}

const payload = Buffer.from(JSON.stringify({
  v: 1,
  school,
  issued: new Date().toISOString().slice(0, 10)
}));
const signature = sign(null, payload, fs.readFileSync(privatePath, 'utf8')); // Ed25519
const key = `UNISCHED1.${payload.toString('base64url')}.${signature.toString('base64url')}`;

console.log(`License key for "${school}":\n`);
console.log(key);
console.log('\nSend this whole line to the school — they paste it into the activation screen on first launch.');
