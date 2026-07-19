const crypto = require('crypto');

// Excludes visually-confusable characters (0/O, 1/l/I) since these are read
// off a screen and typed in by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** Generates a random temporary password, e.g. "k7Rp2QxM9f". Always >= 8 chars to satisfy isValidPassword. */
function generateTempPassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
}

module.exports = { generateTempPassword };
