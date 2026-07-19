/**
 * Formatting rules for university ID numbers. Pure functions only (no DB
 * access) so this can be required from db.js without a circular dependency —
 * db.js wraps these with an actual lookup of existing IDs (see
 * `nextIdNumberForRole` there).
 *
 * Students:        YYYY-NNNN   e.g. 2026-0001  (year the account was created + a
 *                  sequential number, reset each year)
 * Faculty/Admin:   EMP-YYYY-NNNN   e.g. EMP-2026-0001  (same shape, "EMP-" makes a
 *                  staff ID visually distinct from a student ID at a glance)
 */

const SEQ_DIGITS = 4;

function idPrefixFor(role, year) {
  return role === 'student' ? `${year}-` : `EMP-${year}-`;
}

/** Next sequence number for `prefix`, given the ID numbers already in use — scans
    for the highest existing suffix rather than counting rows, so a deleted
    account never causes its old number to be reissued to someone else. */
function nextSequenceNumber(prefix, existingIdNumbers) {
  let max = 0;
  for (const idNumber of existingIdNumbers) {
    if (!idNumber || !idNumber.startsWith(prefix)) continue;
    const n = parseInt(idNumber.slice(prefix.length), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

function formatIdNumber(role, year, seq) {
  return `${idPrefixFor(role, year)}${String(seq).padStart(SEQ_DIGITS, '0')}`;
}

module.exports = { idPrefixFor, nextSequenceNumber, formatIdNumber };
