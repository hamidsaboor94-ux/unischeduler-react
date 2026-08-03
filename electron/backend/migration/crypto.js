const crypto = require('crypto');

if (!process.env.MIGRATION_ENC_KEY && process.env.NODE_ENV === 'production') {
  throw new Error(
    'MIGRATION_ENC_KEY must be set when NODE_ENV=production — refusing to start with the ' +
    'default development key, which would let anyone with the source decrypt saved migration ' +
    'source-database passwords.'
  );
}
if (!process.env.MIGRATION_ENC_KEY) {
  console.warn(
    '\n⚠️  MIGRATION_ENC_KEY is not set — using an insecure derived development key.\n' +
    '   Set the MIGRATION_ENC_KEY environment variable before deploying this anywhere real.\n'
  );
}

const ALGORITHM = 'aes-256-gcm';
const RAW_KEY = process.env.MIGRATION_ENC_KEY || 'dev-migration-key';

// A real key is a 64-hex-char (32-byte) string, used directly. Anything else (including the dev
// fallback above) is run through scrypt so a low-friction dev value still produces a valid
// 32-byte AES-256 key rather than failing outright.
const KEY = /^[0-9a-f]{64}$/i.test(RAW_KEY)
  ? Buffer.from(RAW_KEY, 'hex')
  : crypto.scryptSync(RAW_KEY, 'migration-enc-salt', 32);

/** Encrypts `plaintext` (a saved source-DB password) into a single
    `base64(iv):base64(authTag):base64(ciphertext)` string. A fresh random IV every call means two
    encryptions of the same plaintext never look alike. */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map(b => b.toString('base64')).join(':');
}

/** Reverses encrypt(). Throws if the payload was tampered with (GCM auth-tag check) or wasn't
    produced by encrypt() in the first place — callers should never catch this to fall back to
    treating the payload as plaintext. */
function decrypt(payload) {
  const parts = String(payload).split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted payload');
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
