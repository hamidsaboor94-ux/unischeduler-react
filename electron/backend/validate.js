const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

/** True for a value that will become a positive integer in SQLite (e.g. capacity, credits, maxStudents). */
function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

module.exports = { isValidEmail, isValidPassword, isPositiveInt };
