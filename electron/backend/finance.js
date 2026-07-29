/**
 * Finance domain logic. Fees are charged per credit: a single institution-wide
 * rate (settings 'perCreditFee') times each enrolled course's credits. A
 * student's charge is derived live from their current enrollments — never stored
 * — so it always reflects reality as they add/drop courses or the rate changes.
 * Payments are recorded as installments (the payments table); the balance is
 * simply total charged minus total paid. A positive balance is a financial hold.
 */
const { get, all } = require('./db');

async function getSetting(key, fallback) {
  const row = await get('SELECT value FROM settings WHERE key = ?', [key]);
  return row && row.value != null && row.value !== '' ? row.value : fallback;
}

/** The per-credit fee (a plain number; 0 means fees aren't configured yet). */
async function getPerCreditFee() {
  const n = Number(await getSetting('perCreditFee', 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Optional display currency label (e.g. "AFN", "USD"); blank if unset. */
async function getCurrency() {
  return await getSetting('currency', '');
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * A student's full financial statement: each enrolled course with its own
 * per-course fee (credits x rate), the totals, every payment (receipt), the
 * outstanding balance, and whether that balance is a hold.
 */
async function studentStatement(studentId) {
  const rate = await getPerCreditFee();
  const currency = await getCurrency();
  const courses = await all(
    `SELECT c.id, c.code, c.name, c.credits
     FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE e.studentId = ? AND e.status = 'enrolled' ORDER BY c.code`,
    [studentId]
  );
  const courseLines = courses.map(c => ({
    id: c.id, code: c.code, name: c.name, credits: c.credits || 0,
    fee: round2((c.credits || 0) * rate),
  }));
  const totalCharged = round2(courseLines.reduce((sum, c) => sum + c.fee, 0));

  const payments = await all(
    'SELECT id, amount, method, reference, note, receiptNo, paidAt FROM payments WHERE studentId = ? ORDER BY paidAt DESC, id DESC',
    [studentId]
  );
  const totalPaid = round2(payments.reduce((sum, p) => sum + (p.amount || 0), 0));
  const balance = round2(totalCharged - totalPaid);

  return {
    rate, currency,
    courses: courseLines,
    totalCharged, totalPaid, balance,
    // A hold only exists once fees are actually configured — no rate, no hold.
    hasHold: rate > 0 && balance > 0,
    payments,
  };
}

/** True if the student currently owes money (blocks midterm/final exams). */
async function hasFinancialHold(studentId) {
  const rate = await getPerCreditFee();
  if (rate <= 0) return false;
  const s = await studentStatement(studentId);
  return s.balance > 0;
}

module.exports = { getPerCreditFee, getCurrency, studentStatement, hasFinancialHold, round2 };
