const express = require('express');
const { get, all, run, logAudit, transaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const asyncHandler = require('../middleware/asyncHandler');
const finance = require('../finance');
const {
  studentStatement, getPerCreditFee, getCurrency,
  getTermFeeConfig, setTermFeeConfig,
  FEE_SCOPES, getFeeRules, createFeeRule, updateFeeRule, deleteFeeRule,
  FEE_TYPES, getFeeItems, createFeeItem, updateFeeItem, deleteFeeItem,
  getFeePlan, setFeePlan,
  computeGrossCharge, generateCharges,
  AID_TYPES, AID_BASES, awardAid, reviseAid, revokeAid,
  postPaymentTransaction, reversePaymentTransaction,
  financeWorklist, round2,
  computeStudentTotals, buildReceiptSnapshot, getReceipt,
  receivablesAging, todayCollections, recentFinancialActivity, termSummary,
  overdueInstallments, upcomingInstallments,
} = finance;

const router = express.Router();
const PAYMENT_METHODS = ['cash', 'bank', 'card', 'mobile', 'other'];
const SCHOLARSHIP_TYPES = ['fixed', 'percentage'];
const { safeCreateNotification, createBulkNotifications } = require('../notificationTypes');

async function setSetting(key, value) {
  await run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

async function requireTerm(req, res) {
  const term = await get('SELECT id, name FROM terms WHERE id = ?', [req.params.termId]);
  if (!term) { res.status(404).json({ error: 'Term not found' }); return null; }
  return term;
}

// --- Legacy global fee configuration (per-credit rate + currency) — kept as the fallback
// default for any term without its own term_fee_config row (see finance.js) ---

router.get('/settings', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  res.json({ perCreditFee: await getPerCreditFee(), currency: await getCurrency() });
}));

// Sets the global fallback fee-per-credit/currency — a policy decision, admin-only (see
// PUT /terms/:termId/config below, which is the same kind of change at the per-term level).
router.put('/settings', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
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

// --- Per-term fee configuration: rate/currency, fixed fee items, installment plan ---

router.get('/terms/:termId/config', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const term = await requireTerm(req, res); if (!term) return;
  const termId = term.id;
  res.json({
    ...(await getTermFeeConfig(termId)),
    feeItems: await getFeeItems(termId),
    feePlan: await getFeePlan(termId),
    feeRules: await enrichFeeRules(await getFeeRules(termId)),
  });
}));

// Fee-per-credit/currency for one term — a policy action (sets the rate every enrolled student
// gets billed at), not an operational one, so it's admin-only even though the rest of Finance
// write access belongs to the Bursar. Reads stay on requirePermission('finance','read') above so
// the Bursar's dashboard can still display the configured rate/currency.
router.put('/terms/:termId/config', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const term = await requireTerm(req, res); if (!term) return;
  const { feePerCredit, currency } = req.body;
  const n = Number(feePerCredit);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Fee per credit must be a non-negative number' });
  const config = await setTermFeeConfig(term.id, { feePerCredit: n, currency }, req.user.sub);
  await logAudit(req.user, 'update', 'term_fee_config', term.id, config);
  res.json(config);
}));

/** Validates {scope, scopeId, studentTypeId} shared by fee-items and fee-rules: scope must be
 *  one of FEE_SCOPES, scopeId must resolve to a real college/department/program (or be absent
 *  for 'university'), and studentTypeId, if given, must be a real student type. Returns
 *  { scope, scopeId, studentTypeId } (numbers, scopeId/studentTypeId defaulting to 0) on success
 *  or { error } on failure. */
async function resolveScope(body) {
  const scope = FEE_SCOPES.includes(body.scope) ? body.scope : null;
  if (!scope) return { error: `scope must be one of: ${FEE_SCOPES.join(', ')}` };
  let scopeId = 0;
  if (scope !== 'university') {
    scopeId = Number(body.scopeId);
    if (!(scopeId > 0)) return { error: `scopeId is required when scope is '${scope}'` };
    const table = scope === 'college' ? 'colleges' : scope === 'department' ? 'departments' : 'programs';
    if (!(await get(`SELECT id FROM ${table} WHERE id = ?`, [scopeId]))) {
      return { error: `${scope[0].toUpperCase()}${scope.slice(1)} not found` };
    }
  }
  let studentTypeId = 0;
  if (body.studentTypeId) {
    studentTypeId = Number(body.studentTypeId);
    if (!(await get('SELECT id FROM student_types WHERE id = ?', [studentTypeId]))) {
      return { error: 'Student type not found' };
    }
  }
  return { scope, scopeId, studentTypeId };
}

// --- Fee structure (rules/items/plan) below: same policy-vs-operational split as the term
// config above — admin-only to write, Bursar keeps read (see the GET routes further down). ---

router.post('/terms/:termId/fee-items', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const term = await requireTerm(req, res); if (!term) return;
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Fee item name is required' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
  const scopeResult = await resolveScope(req.body);
  if (scopeResult.error) return res.status(400).json({ error: scopeResult.error });
  const feeType = FEE_TYPES.includes(req.body.feeType) ? req.body.feeType : 'other';
  const { scope, scopeId, studentTypeId } = scopeResult;
  try {
    const item = await createFeeItem(term.id, {
      name, amount, scope, scopeId, studentTypeId, feeType,
      mandatory: req.body.mandatory !== false, isActive: req.body.isActive !== false,
      effectiveDate: req.body.effectiveDate || null,
    }, req.user.sub);
    await logAudit(req.user, 'create', 'fee_items', item.id, item);
    res.status(201).json(item);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A fee item with this exact name and scope already exists for this term.' });
    throw err;
  }
}));

router.put('/fee-items/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM fee_items WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Fee item not found' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Fee item name is required' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
  const scopeResult = await resolveScope(req.body);
  if (scopeResult.error) return res.status(400).json({ error: scopeResult.error });
  const feeType = FEE_TYPES.includes(req.body.feeType) ? req.body.feeType : 'other';
  const { scope, scopeId, studentTypeId } = scopeResult;
  try {
    const item = await updateFeeItem(existing.id, {
      name, amount, scope, scopeId, studentTypeId, feeType,
      mandatory: req.body.mandatory !== false, isActive: req.body.isActive !== false,
      effectiveDate: req.body.effectiveDate || null,
    });
    await logAudit(req.user, 'update', 'fee_items', item.id, item);
    res.json(item);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A fee item with this exact name and scope already exists for this term.' });
    throw err;
  }
}));

router.delete('/fee-items/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM fee_items WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Fee item not found' });
  await deleteFeeItem(existing.id);
  await logAudit(req.user, 'delete', 'fee_items', existing.id, existing);
  res.status(204).end();
}));

// --- Hierarchical tuition fee rules (fee-per-credit by college/department/program/student type) ---

/** Attaches human-readable names for display: a rule's scope target (college/department/program
 *  name, or null for 'university') and its student type name (or null for "all types"). */
async function enrichFeeRules(rules) {
  if (!rules.length) return rules;
  const [colleges, departments, programs, studentTypes] = await Promise.all([
    all('SELECT id, name FROM colleges'), all('SELECT id, name FROM departments'),
    all('SELECT id, name FROM programs'), all('SELECT id, name FROM student_types'),
  ]);
  const byId = { college: new Map(colleges.map(c => [c.id, c.name])), department: new Map(departments.map(d => [d.id, d.name])), program: new Map(programs.map(p => [p.id, p.name])) };
  const stById = new Map(studentTypes.map(s => [s.id, s.name]));
  return rules.map(r => ({
    ...r,
    scopeName: r.scope === 'university' ? null : (byId[r.scope]?.get(r.scopeId) || null),
    studentTypeName: r.studentTypeId ? (stById.get(r.studentTypeId) || null) : null,
  }));
}

router.get('/terms/:termId/fee-rules', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const term = await requireTerm(req, res); if (!term) return;
  res.json(await enrichFeeRules(await getFeeRules(term.id)));
}));

router.post('/terms/:termId/fee-rules', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const term = await requireTerm(req, res); if (!term) return;
  const scopeResult = await resolveScope(req.body);
  if (scopeResult.error) return res.status(400).json({ error: scopeResult.error });
  const feePerCredit = Number(req.body.feePerCredit);
  if (!Number.isFinite(feePerCredit) || feePerCredit < 0) return res.status(400).json({ error: 'Fee per credit must be a non-negative number' });
  const { scope, scopeId, studentTypeId } = scopeResult;
  try {
    const rule = await createFeeRule(term.id, { scope, scopeId, studentTypeId, feePerCredit, effectiveDate: req.body.effectiveDate || null }, req.user.sub);
    await logAudit(req.user, 'create', 'fee_rules', rule.id, rule);
    res.status(201).json((await enrichFeeRules([rule]))[0]);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A fee rule already exists for this exact scope and student type in this term — edit or deactivate it instead of creating a duplicate.' });
    throw err;
  }
}));

router.put('/fee-rules/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM fee_rules WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Fee rule not found' });
  if (req.body.feePerCredit !== undefined) {
    const n = Number(req.body.feePerCredit);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Fee per credit must be a non-negative number' });
  }
  const rule = await updateFeeRule(existing.id, {
    feePerCredit: req.body.feePerCredit !== undefined ? Number(req.body.feePerCredit) : undefined,
    isActive: req.body.isActive,
    effectiveDate: req.body.effectiveDate,
  }, req.user.sub);
  await logAudit(req.user, 'update', 'fee_rules', rule.id, rule);
  res.json((await enrichFeeRules([rule]))[0]);
}));

router.delete('/fee-rules/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM fee_rules WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Fee rule not found' });
  await deleteFeeRule(existing.id);
  await logAudit(req.user, 'delete', 'fee_rules', existing.id, existing);
  res.status(204).end();
}));

router.get('/terms/:termId/fee-plan', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const term = await requireTerm(req, res); if (!term) return;
  res.json(await getFeePlan(term.id));
}));

router.put('/terms/:termId/fee-plan', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const term = await requireTerm(req, res); if (!term) return;
  const installmentCount = Number(req.body.installmentCount);
  if (!Number.isFinite(installmentCount) || installmentCount < 1) return res.status(400).json({ error: 'Installment count must be at least 1' });
  const plan = await setFeePlan(term.id, { installmentCount, installments: req.body.installments });
  await logAudit(req.user, 'update', 'fee_plans', term.id, plan);
  res.json(plan);
}));

// --- Generate charges for every registered student in a term (idempotent) ---

router.post('/terms/:termId/generate-charges', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const term = await requireTerm(req, res); if (!term) return;
  let summary;
  try {
    summary = await generateCharges(term.id, req.user);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  await logAudit(req.user, 'generate-charges', 'finance_transactions', term.id, summary);
  const billed=await all(`SELECT DISTINCT e.studentId id FROM enrollments e JOIN courses c ON c.id=e.courseId WHERE e.status='enrolled' AND c.termId=?`,[term.id]);
  await createBulkNotifications({recipientUserIds:billed.map(x=>x.id),type:'invoice_generated',title:'New university invoice',
    message:`Charges for ${term.name} are now available in your protected finance statement.`,severity:'info',entityType:'term',entityId:term.id,
    actionSection:'my-fees',deduplicationKeyPrefix:`invoice-generated:${term.id}`,createdBy:req.user.sub,category:'finance_reminders'});
  res.json(summary);
}));

// --- All students with their balance summary (the Bursar's worklist) ---

router.get('/students', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const termId = req.query.termId ? Number(req.query.termId) : null;
  const students = await financeWorklist(termId);
  res.json({ currency: await getCurrency(), students });
}));

// --- Bursar overview aggregates: receivables aging, today's collections, recent activity ---

router.get('/reports/aging', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const termId = req.query.termId ? Number(req.query.termId) : null;
  res.json(await receivablesAging(termId));
}));

router.get('/reports/today-collections', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const termId = req.query.termId ? Number(req.query.termId) : null;
  res.json(await todayCollections(termId));
}));

router.get('/reports/recent-activity', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const termId = req.query.termId ? Number(req.query.termId) : null;
  const limit = req.query.limit ? Number(req.query.limit) : 15;
  res.json(await recentFinancialActivity(termId, limit));
}));

router.get('/reports/term-summary', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 12;
  res.json(await termSummary(limit));
}));

router.get('/reports/overdue-installments', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const termId = req.query.termId ? Number(req.query.termId) : null;
  res.json(await overdueInstallments(termId));
}));

router.get('/reports/upcoming-installments', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const termId = req.query.termId ? Number(req.query.termId) : null;
  const days = req.query.days ? Number(req.query.days) : 30;
  res.json(await upcomingInstallments(termId, days));
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
  const termId = req.query.termId ? Number(req.query.termId) : null;
  res.json({ student, ...(await studentStatement(studentId, termId)) });
}));

// --- Preview what generate-charges would compute for a student, without saving anything ---

router.get('/students/:studentId/preview', requireAuth, requirePermission('finance', 'read'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  const termId = Number(req.query.termId);
  if (!termId) return res.status(400).json({ error: 'termId is required' });
  res.json(await computeGrossCharge(studentId, termId));
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
  const termId = req.body.termId ? Number(req.body.termId) : null;

  // Recording the payment, mirroring it into the ledger, and reallocating installments must
  // succeed or fail together — a payment row with no matching ledger/allocation (or vice versa)
  // would leave the student's balance inconsistent with what was actually collected.
  const payment = await transaction(async () => {
    // Captured before the ledger entry is posted — this is what buildReceiptSnapshot() freezes as
    // the receipt's "previous outstanding balance" (see finance.js).
    const preTotals = await computeStudentTotals(studentId);
    const previousBalance = preTotals.balance;
    const previousCredit = preTotals.creditBalance;

    const result = await run(
      'INSERT INTO payments (studentId, amount, method, reference, note, createdBy, termId) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [studentId, round2(amount), method, reference, note, req.user.sub, termId]
    );
    const receiptNo = `RCPT-${String(result.id).padStart(5, '0')}`;
    await run('UPDATE payments SET receiptNo = ? WHERE id = ?', [receiptNo, result.id]);
    const inserted = await get('SELECT id, studentId, amount, method, reference, note, receiptNo, paidAt, createdBy, termId FROM payments WHERE id = ?', [result.id]);
    await postPaymentTransaction(inserted, req.user);
    const snapshot = await buildReceiptSnapshot(inserted, previousBalance, previousCredit);
    await run('UPDATE payments SET receiptSnapshot = ? WHERE id = ?', [JSON.stringify(snapshot), inserted.id]);
    return inserted;
  });
  await logAudit(req.user, 'record-payment', 'payments', payment.id, { studentId, amount: round2(amount), method, receiptNo: payment.receiptNo });
  const statement=await studentStatement(studentId,termId);
  await safeCreateNotification({recipientUserId:studentId,type:'payment_recorded',title:'Payment recorded',
    message:`Your payment was recorded. Receipt ${payment.receiptNo} is available in your protected finance page.`,severity:'success',entityType:'payment',entityId:payment.id,
    actionSection:'my-fees',deduplicationKey:`payment-recorded:${payment.id}`,createdBy:req.user.sub});
  await safeCreateNotification({recipientUserId:studentId,type:'receipt_generated',title:'Receipt available',message:'An official payment receipt is available.',
    severity:'info',entityType:'payment',entityId:payment.id,actionSection:'my-fees',deduplicationKey:`receipt-generated:${payment.id}`,createdBy:req.user.sub});
  if(statement.balance<=0.004)await safeCreateNotification({recipientUserId:studentId,type:'account_cleared',title:'Account fully paid',
    message:'Your current university account is fully paid.',severity:'success',entityType:'student',entityId:studentId,actionSection:'my-fees',
    deduplicationKey:`account-cleared:${studentId}:${termId||'all'}:${payment.id}`,createdBy:req.user.sub});

  res.status(201).json({ payment, statement });
}));

// --- A payment's full receipt — finance staff for anyone, a student for their own. Immutable
// (frozen at record time — see finance.js's buildReceiptSnapshot/getReceipt) except for its
// live status/void fields. ---

router.get('/payments/:id/receipt', requireAuth, asyncHandler(async (req, res) => {
  const receipt = await getReceipt(Number(req.params.id));
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
  if (Number(req.user.sub) !== Number(receipt.studentId)) {
    const { can } = require('../permissions');
    if (!can(req.user.role, 'finance', 'read')) return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(receipt);
}));

// --- Void a payment (correction) — finance write. Reverses the ledger entry but keeps the
// payments row itself (status='reversed') so a completed financial transaction is never deleted. ---

router.delete('/payments/:id', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const payment = await get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'reversed') return res.status(400).json({ error: 'Payment has already been voided' });
  await transaction(async () => {
    await reversePaymentTransaction(payment);
    await run(`UPDATE payments SET status = 'reversed', voidedAt = CURRENT_TIMESTAMP, voidedBy = ? WHERE id = ?`, [req.user.sub, req.params.id]);
  });
  await logAudit(
    req.user, 'void-payment', 'payments', payment.id,
    { studentId: payment.studentId, amount: payment.amount, receiptNo: payment.receiptNo },
    { status: 'completed' }, { status: 'reversed' }
  );
  res.status(204).end();
}));

// --- Legacy scholarship endpoints — unchanged; superseded by /aid below (see finance.js header) ---

router.post('/students/:studentId/scholarships', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  const student = await get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Scholarship name is required' });
  const type = SCHOLARSHIP_TYPES.includes(req.body.type) ? req.body.type : 'fixed';
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
  if (type === 'percentage' && amount > 100) return res.status(400).json({ error: 'A percentage scholarship cannot exceed 100' });
  const termId = req.body.termId ? Number(req.body.termId) : null;
  const note = req.body.note ? String(req.body.note).slice(0, 500) : null;

  const result = await run(
    'INSERT INTO scholarships (studentId, name, type, amount, termId, note, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [studentId, name.slice(0, 120), type, amount, termId, note, req.user.sub]
  );
  await logAudit(req.user, 'create', 'scholarships', result.id, { studentId, name, type, amount, termId });

  const scholarship = await get('SELECT id, name, type, amount, termId, note, createdAt FROM scholarships WHERE id = ?', [result.id]);
  res.status(201).json({ scholarship, statement: await studentStatement(studentId) });
}));

router.delete('/scholarships/:id', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const scholarship = await get('SELECT * FROM scholarships WHERE id = ?', [req.params.id]);
  if (!scholarship) return res.status(404).json({ error: 'Scholarship not found' });
  await run('DELETE FROM scholarships WHERE id = ?', [req.params.id]);
  await logAudit(req.user, 'delete', 'scholarships', scholarship.id, { studentId: scholarship.studentId, name: scholarship.name, amount: scholarship.amount });
  res.status(204).end();
}));

// --- Financial aid (scholarship/grant/waiver/discount) — the ledger-integrated model ---

router.post('/students/:studentId/aid', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const studentId = Number(req.params.studentId);
  const student = await get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const term = await get('SELECT id FROM terms WHERE id = ?', [req.body.termId]);
  if (!term) return res.status(400).json({ error: 'A valid termId is required' });
  const type = AID_TYPES.includes(req.body.type) ? req.body.type : null;
  if (!type) return res.status(400).json({ error: `Type must be one of: ${AID_TYPES.join(', ')}` });
  const basis = AID_BASES.includes(req.body.basis) ? req.body.basis : null;
  if (!basis) return res.status(400).json({ error: `Basis must be one of: ${AID_BASES.join(', ')}` });
  const value = Number(req.body.value);
  if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Value must be a positive number' });
  if (basis === 'percentage' && value > 100) return res.status(400).json({ error: 'A percentage award cannot exceed 100' });
  const reason = req.body.reason ? String(req.body.reason).slice(0, 500) : null;

  const aid = await awardAid(studentId, term.id, { type, basis, value, reason }, req.user);
  await logAudit(req.user, 'create', 'student_financial_aid', aid.id, { studentId, termId: term.id, type, basis, value });
  res.status(201).json({ aid, statement: await studentStatement(studentId, term.id) });
}));

router.put('/aid/:id', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM student_financial_aid WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Aid award not found' });
  const value = req.body.value !== undefined ? Number(req.body.value) : undefined;
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) return res.status(400).json({ error: 'Value must be a positive number' });
  if (value !== undefined && existing.basis === 'percentage' && value > 100) return res.status(400).json({ error: 'A percentage award cannot exceed 100' });
  const reason = req.body.reason !== undefined ? (req.body.reason ? String(req.body.reason).slice(0, 500) : null) : undefined;

  const aid = await reviseAid(existing.id, { value, reason }, req.user);
  await logAudit(req.user, 'update', 'student_financial_aid', aid.id, { value, reason });
  res.json({ aid, statement: await studentStatement(existing.studentId, existing.termId) });
}));

router.delete('/aid/:id', requireAuth, requirePermission('finance', 'write'), asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM student_financial_aid WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Aid award not found' });
  const aid = await revokeAid(existing.id);
  await logAudit(req.user, 'revoke', 'student_financial_aid', aid.id, { studentId: aid.studentId, termId: aid.termId, type: aid.type });
  res.json({ aid, statement: await studentStatement(existing.studentId, existing.termId) });
}));

// --- A student's own statement (self-scoped; drives their My Fees page + hold banner) ---

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') {
    return res.json({
      courses: [], payments: [], scholarships: [], aid: [], installments: [], term: null,
      totalCharged: 0, totalAid: 0, totalPaid: 0, netPayable: 0, balance: 0,
      status: 'not_billed', hasHold: false, rate: 0, currency: '',
    });
  }
  let termId = req.query.termId ? Number(req.query.termId) : null;
  if (!termId) {
    const activeTerm = await get('SELECT id FROM terms WHERE isActive = 1 LIMIT 1');
    termId = activeTerm ? activeTerm.id : null;
  }
  res.json(await studentStatement(req.user.sub, termId));
}));

module.exports = router;
