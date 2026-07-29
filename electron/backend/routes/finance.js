const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const asyncHandler = require('../middleware/asyncHandler');
const { studentStatement, getPerCreditFee, getCurrency, round2 } = require('../finance');

const router = express.Router();
const PAYMENT_METHODS = ['cash', 'bank', 'card', 'mobile', 'other'];

async function setSetting(key, value) {
  await run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// --- Fee configuration (per-credit rate + currency) — read by finance staff, written by Bursar/admin ---

router.get('/settings', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  res.json({ perCreditFee: await getPerCreditFee(), currency: await getCurrency() });
}));

router.put('/settings', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const { perCreditFee, currency } = req.body;
  if (perCreditFee !== undefined) {
    const n = Number(perCreditFee);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Per-credit fee must be a non-negative number' });
    await setSetting('perCreditFee', String(n));
  }
  if (currency !== undefined) await setSetting('currency', String(currency).trim().slice(0, 8));
  await logAudit(req.user, 'update', 'finance_settings', null, { perCreditFee, currency });
  res.json({ perCreditFee: await getPerCreditFee(), currency: await getCurrency() });
}));

// --- All students with their balance summary (the Bursar's worklist) ---

router.get('/students', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const rate = await getPerCreditFee();
  const currency = await getCurrency();
  // One aggregate query: charged (credits x rate) vs paid, per student.
  const rows = await all(
    `SELECT u.id as studentId, u.name, u.email, u.idNumber,
            COALESCE((SELECT SUM(c.credits) FROM enrollments e JOIN courses c ON c.id = e.courseId
                      WHERE e.studentId = u.id AND e.status = 'enrolled'), 0) AS credits,
            COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.studentId = u.id), 0) AS totalPaid
     FROM users u WHERE u.role = 'student' ORDER BY u.name`
  );
  const students = rows.map(r => {
    const totalCharged = round2((r.credits || 0) * rate);
    const totalPaid = round2(r.totalPaid || 0);
    const balance = round2(totalCharged - totalPaid);
    return {
      studentId: r.studentId, name: r.name, email: r.email, idNumber: r.idNumber,
      credits: r.credits || 0, totalCharged, totalPaid, balance,
      hasHold: rate > 0 && balance > 0,
    };
  });
  res.json({ rate, currency, students });
}));

// --- One student's full statement — finance staff for anyone, a student for themselves ---

function canViewStatement(req, studentId) {
  if (Number(req.user.sub) === Number(studentId)) return true;
  const { can } = require('../permissions');
  return can(req.user.role, 'finance', 'read');
}

router.get('/students/:studentId', requireAuth, asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!canViewStatement(req, studentId)) return res.status(403).json({ error: 'Forbidden' });
  const student = await get(`SELECT id, name, email, idNumber FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json({ student, ...(await studentStatement(studentId)) });
}));

// --- Record an installment payment → its receipt ---

router.post('/students/:studentId/payments', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  const student = await get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
  const method = PAYMENT_METHODS.includes(req.body.method) ? req.body.method : 'cash';
  const reference = req.body.reference ? String(req.body.reference).slice(0, 120) : null;
  const note = req.body.note ? String(req.body.note).slice(0, 500) : null;

  const result = await run(
    'INSERT INTO payments (studentId, amount, method, reference, note, createdBy) VALUES (?, ?, ?, ?, ?, ?)',
    [studentId, round2(amount), method, reference, note, req.user.sub]
  );
  const receiptNo = `RCPT-${String(result.id).padStart(5, '0')}`;
  await run('UPDATE payments SET receiptNo = ? WHERE id = ?', [receiptNo, result.id]);
  await logAudit(req.user, 'record-payment', 'payments', result.id, { studentId, amount: round2(amount), method, receiptNo });

  const payment = await get('SELECT id, amount, method, reference, note, receiptNo, paidAt FROM payments WHERE id = ?', [result.id]);
  res.status(201).json({ payment, statement: await studentStatement(studentId) });
}));

// --- Void a payment (correction) — finance write ---

router.delete('/payments/:id', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const payment = await get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  await run('DELETE FROM payments WHERE id = ?', [req.params.id]);
  await logAudit(req.user, 'void-payment', 'payments', payment.id, { studentId: payment.studentId, amount: payment.amount, receiptNo: payment.receiptNo });
  res.status(204).end();
}));

// --- A student's own statement (self-scoped; drives their My Fees page + hold banner) ---

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') return res.json({ courses: [], payments: [], totalCharged: 0, totalPaid: 0, balance: 0, hasHold: false, rate: 0, currency: '' });
  res.json(await studentStatement(req.user.sub));
}));

module.exports = router;
