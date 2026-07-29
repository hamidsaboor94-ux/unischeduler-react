/**
 * Finance domain logic. finance_transactions is the ledger — the single source of truth for
 * every student's balance, built from four kinds of entry: 'charge' (posted by generateCharges,
 * one per student per term, idempotent via a partial unique index), 'payment' (posted by
 * recordPayment, mirrored from the payments table so its receipt/void UI keeps working
 * unchanged), 'aid' (posted by awardAid — a credit, never shrinks the original charge), and the
 * less commonly used 'refund'/'adjustment' for manual corrections. Balance is always the sum of
 * this table: charge + refund + adjustment - payment - aid.
 *
 * computeStudentTotals/studentStatus/studentStatement all take an optional termId: given one,
 * totals/balance/status are scoped to that term (charge/aid/refund/adjustment ledger rows already
 * carry a termId; a term's "paid" is derived from SUM(installments.paidAmount) for that term,
 * since payment rows themselves aren't earmarked to a term when recorded). Omit termId for the
 * old aggregate-across-everything view. A financial HOLD (hasFinancialHold/hasHold) is always the
 * aggregate view regardless of which term is being displayed — an unpaid prior term should still
 * block exams even while looking at a since-cleared current term.
 *
 * Payments allocate to the globally-earliest-unpaid installment (by due date, across every term)
 * every time one is recorded or voided — see reallocateInstallments(), which replays the full
 * payment history from scratch rather than trying to track/undo individual allocations.
 */
const { get, all, run, transaction } = require('./db');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** A raw ledger balance (charge - aid - payment + refund + adjustment) can go negative when a
 *  student has overpaid — that's real credit, not a display quirk, and finance_transactions is
 *  already its persisted record (nothing extra to store: the next generateCharges() call adds a
 *  fresh 'charge' row, which raises the raw balance back toward positive and consumes the credit
 *  automatically, since balance is always recomputed live from this same ledger). Never show the
 *  raw negative to a user — split it into a floor-at-zero balance plus a separate creditBalance. */
function splitBalance(rawBalance) {
  return { balance: round2(Math.max(0, rawBalance)), creditBalance: round2(Math.max(0, -rawBalance)) };
}

/* ------------------------------- Legacy global settings -------------------------------
 * settings.perCreditFee/currency predate per-term fee config. Left fully functional (the
 * existing GET/PUT /finance/settings endpoints still read/write them) so nothing about the
 * current fee-config UI breaks; they now serve as the fallback default for any term that hasn't
 * been given its own term_fee_config row yet. */

async function getSetting(key, fallback) {
  const row = await get('SELECT value FROM settings WHERE key = ?', [key]);
  return row && row.value != null && row.value !== '' ? row.value : fallback;
}
async function getPerCreditFee() {
  const n = Number(await getSetting('perCreditFee', 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
async function getCurrency() {
  return await getSetting('currency', '');
}

/* ------------------------------- Legacy scholarships -------------------------------
 * Kept exactly as before (table, rows, endpoints) per the "don't drop/rename anything" rule, but
 * — unlike before — no longer subtracted into the balance below. Nothing in the UI has ever
 * rendered these (FinancePage.jsx never surfaced a scholarship form or list), so there was no
 * live user-facing behavior to preserve there; student_financial_aid is the model the Finance
 * module now actually uses for discounts/scholarships/grants/waivers, with real ledger and
 * installment integration. Still returned on the statement for completeness. */
async function getScholarships(studentId) {
  return await all(
    'SELECT id, name, type, amount, termId, note, createdAt FROM scholarships WHERE studentId = ? ORDER BY createdAt',
    [studentId]
  );
}

/* ------------------------------------- Term fee config ------------------------------------- */

async function getTermFeeConfig(termId) {
  const row = await get('SELECT feePerCredit, currency FROM term_fee_config WHERE termId = ?', [termId]);
  if (row) return { feePerCredit: row.feePerCredit || 0, currency: row.currency || '' };
  return { feePerCredit: await getPerCreditFee(), currency: await getCurrency() };
}

async function setTermFeeConfig(termId, { feePerCredit, currency }, userId) {
  await run(
    `INSERT INTO term_fee_config (termId, feePerCredit, currency, updatedAt, updatedBy) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(termId) DO UPDATE SET feePerCredit = excluded.feePerCredit, currency = excluded.currency, updatedAt = CURRENT_TIMESTAMP, updatedBy = excluded.updatedBy`,
    [termId, round2(Number(feePerCredit) || 0), String(currency || '').trim().slice(0, 8), userId]
  );
  return getTermFeeConfig(termId);
}

/* ------------------------------------- Fee hierarchy: scope + resolution ------------------------------------- */

/** The four scopes both fee_rules (tuition) and fee_items (fixed fees) resolve against, most to
 *  least specific. scopeId is 0 ("not applicable") for 'university'; otherwise a
 *  colleges/departments/programs id. */
const FEE_SCOPES = ['university', 'college', 'department', 'program'];

/** A student's position in the fee hierarchy, resolved from student_profiles (departmentId,
 *  programId, studentTypeId) plus the department's own collegeId. Any level a student hasn't
 *  been assigned (no department, no program, no student type) simply yields null there — the
 *  resolvers below skip tiers with a null id and fall through toward the university default,
 *  so an unassigned student still bills correctly instead of erroring. */
async function studentHierarchy(studentId) {
  const profile = await get('SELECT departmentId, programId, studentTypeId FROM student_profiles WHERE studentId = ?', [studentId]);
  if (!profile) return { departmentId: null, programId: null, collegeId: null, studentTypeId: null };
  let collegeId = null;
  if (profile.departmentId) {
    const dept = await get('SELECT collegeId FROM departments WHERE id = ?', [profile.departmentId]);
    collegeId = dept?.collegeId || null;
  }
  return {
    departmentId: profile.departmentId || null,
    programId: profile.programId || null,
    collegeId,
    studentTypeId: profile.studentTypeId || null,
  };
}

/** Every (scope, scopeId, studentTypeId) tier to probe, most specific first, per the required
 *  resolution order: Program+Type, Program, Department+Type, Department, College+Type, College,
 *  University+Type, University Default. A tier is only included when the student actually has an
 *  id at that level (e.g. no college tier at all if their department isn't grouped under one —
 *  which is every department, in a single-college deployment; it just falls through to
 *  University). The final 'university'/0/0 tier is intentionally always present as the last
 *  explicit fee_rules row to check, before the caller falls back to legacy term_fee_config. */
function resolutionTiers(h) {
  const tiers = [];
  const st = h.studentTypeId || 0;
  if (h.programId) { tiers.push(['program', h.programId, st]); tiers.push(['program', h.programId, 0]); }
  if (h.departmentId) { tiers.push(['department', h.departmentId, st]); tiers.push(['department', h.departmentId, 0]); }
  if (h.collegeId) { tiers.push(['college', h.collegeId, st]); tiers.push(['college', h.collegeId, 0]); }
  tiers.push(['university', 0, st]);
  tiers.push(['university', 0, 0]);
  return tiers;
}

/** The most specific active fee_rules row for this student/term, or null if none has been
 *  configured at any level (caller falls back to getTermFeeConfig — the pre-hierarchy global
 *  rate — so terms that haven't adopted per-program rules yet keep billing exactly as before). */
async function resolveFeeRule(studentId, termId) {
  const h = await studentHierarchy(studentId);
  const today = todayStr();
  for (const [scope, scopeId, studentTypeId] of resolutionTiers(h)) {
    const rule = await get(
      `SELECT * FROM fee_rules WHERE termId = ? AND scope = ? AND scopeId = ? AND studentTypeId = ?
       AND isActive = 1 AND (effectiveDate IS NULL OR effectiveDate <= ?)`,
      [termId, scope, scopeId, studentTypeId, today]
    );
    if (rule) return rule;
  }
  return null;
}

async function getFeeRules(termId) {
  return await all('SELECT * FROM fee_rules WHERE termId = ? ORDER BY scope, scopeId, studentTypeId', [termId]);
}

async function createFeeRule(termId, { scope, scopeId, studentTypeId, feePerCredit, effectiveDate }, userId) {
  const result = await run(
    'INSERT INTO fee_rules (termId, scope, scopeId, studentTypeId, feePerCredit, effectiveDate, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [termId, scope, scopeId || 0, studentTypeId || 0, round2(Number(feePerCredit)), effectiveDate || null, userId]
  );
  return get('SELECT * FROM fee_rules WHERE id = ?', [result.id]);
}

async function updateFeeRule(id, { feePerCredit, isActive, effectiveDate }, userId) {
  const existing = await get('SELECT * FROM fee_rules WHERE id = ?', [id]);
  if (!existing) return null;
  await run(
    'UPDATE fee_rules SET feePerCredit = ?, isActive = ?, effectiveDate = ?, updatedAt = CURRENT_TIMESTAMP, updatedBy = ? WHERE id = ?',
    [
      feePerCredit != null ? round2(Number(feePerCredit)) : existing.feePerCredit,
      isActive != null ? (isActive ? 1 : 0) : existing.isActive,
      effectiveDate !== undefined ? (effectiveDate || null) : existing.effectiveDate,
      userId, id,
    ]
  );
  return get('SELECT * FROM fee_rules WHERE id = ?', [id]);
}

async function deleteFeeRule(id) {
  await run('DELETE FROM fee_rules WHERE id = ?', [id]);
}

/* ------------------------------------- Fee items (fixed fees) ------------------------------------- */

const FEE_TYPES = ['tuition', 'registration', 'technology', 'library', 'laboratory', 'activity', 'transport', 'hostel', 'other'];

async function getFeeItems(termId) {
  return await all('SELECT * FROM fee_items WHERE termId = ? ORDER BY id', [termId]);
}

async function createFeeItem(termId, { name, amount, scope, scopeId, studentTypeId, feeType, mandatory, isActive, effectiveDate }, userId) {
  const result = await run(
    `INSERT INTO fee_items (termId, name, amount, scope, scopeId, studentTypeId, feeType, mandatory, isActive, effectiveDate, createdBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      termId, String(name).slice(0, 120), round2(Number(amount)), scope, scopeId || 0, studentTypeId || 0,
      feeType || 'other', mandatory === false ? 0 : 1, isActive === false ? 0 : 1, effectiveDate || null, userId,
    ]
  );
  return get('SELECT * FROM fee_items WHERE id = ?', [result.id]);
}

async function updateFeeItem(id, { name, amount, scope, scopeId, studentTypeId, feeType, mandatory, isActive, effectiveDate }) {
  await run(
    `UPDATE fee_items SET name = ?, amount = ?, scope = ?, scopeId = ?, studentTypeId = ?, feeType = ?, mandatory = ?, isActive = ?, effectiveDate = ? WHERE id = ?`,
    [
      String(name).slice(0, 120), round2(Number(amount)), scope, scopeId || 0, studentTypeId || 0,
      feeType || 'other', mandatory === false ? 0 : 1, isActive === false ? 0 : 1, effectiveDate || null, id,
    ]
  );
  return get('SELECT * FROM fee_items WHERE id = ?', [id]);
}

async function deleteFeeItem(id) {
  await run('DELETE FROM fee_items WHERE id = ?', [id]);
}

/** Fixed fee items that actually apply to this student: scope must match their own
 *  college/department/program (or be 'university', which always matches), AND — if the item is
 *  further restricted to a studentTypeId — their student type must match it too. A BBA student
 *  never receives a BCS-scoped laboratory fee, and vice versa, because scope+scopeId simply won't
 *  match; multiple distinct items can apply simultaneously (this isn't a resolution-priority
 *  pick like fee_rules — every matching fixed fee is charged). */
async function applicableFeeItems(studentId, termId) {
  const items = (await getFeeItems(termId)).filter(f => f.isActive);
  if (!items.length) return [];
  const h = await studentHierarchy(studentId);
  const today = todayStr();
  return items.filter(f => {
    if (f.effectiveDate && f.effectiveDate > today) return false;
    let scopeMatches;
    if (f.scope === 'university') scopeMatches = true;
    else if (f.scope === 'college') scopeMatches = h.collegeId != null && Number(h.collegeId) === Number(f.scopeId);
    else if (f.scope === 'department') scopeMatches = h.departmentId != null && Number(h.departmentId) === Number(f.scopeId);
    else if (f.scope === 'program') scopeMatches = h.programId != null && Number(h.programId) === Number(f.scopeId);
    else scopeMatches = false;
    if (!scopeMatches) return false;
    if (f.studentTypeId) return h.studentTypeId != null && Number(h.studentTypeId) === Number(f.studentTypeId);
    return true;
  });
}

/* ------------------------------------- Fee plan (installment template) ------------------------------------- */

async function getFeePlan(termId) {
  const plan = await get('SELECT * FROM fee_plans WHERE termId = ?', [termId]);
  if (!plan) return null;
  const installments = await all(
    'SELECT installmentNo, dueDate, percentage FROM fee_plan_installments WHERE feePlanId = ? ORDER BY installmentNo',
    [plan.id]
  );
  return { installmentCount: plan.installmentCount, installments };
}

async function setFeePlan(termId, { installmentCount, installments }) {
  const count = Math.max(1, Math.min(24, Number(installmentCount) || 1));
  const rows = Array.isArray(installments) ? installments : [];
  await run(
    `INSERT INTO fee_plans (termId, installmentCount, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(termId) DO UPDATE SET installmentCount = excluded.installmentCount, updatedAt = CURRENT_TIMESTAMP`,
    [termId, count]
  );
  const plan = await get('SELECT id FROM fee_plans WHERE termId = ?', [termId]);
  await run('DELETE FROM fee_plan_installments WHERE feePlanId = ?', [plan.id]);
  for (let i = 1; i <= count; i++) {
    const def = rows.find(r => Number(r.installmentNo) === i) || {};
    await run(
      'INSERT INTO fee_plan_installments (feePlanId, installmentNo, dueDate, percentage) VALUES (?, ?, ?, ?)',
      [plan.id, i, def.dueDate || null, def.percentage != null && def.percentage !== '' ? Number(def.percentage) : null]
    );
  }
  return getFeePlan(termId);
}

/** Splits `amount` (the term's gross totalCharged — aid is applied afterward, see
 *  applyAidToInstallments) across the term's configured installments. Uses each installment's
 *  configured percentage when every installment in the plan has one; otherwise splits evenly. Any
 *  rounding remainder lands on the last installment so the schedule always sums exactly to
 *  `amount`. */
function splitInstallments(amount, plan) {
  const template = plan && plan.installments.length ? plan.installments : [{ installmentNo: 1, dueDate: null, percentage: null }];
  const count = plan ? plan.installmentCount : 1;
  const usePercentages = template.length === count && template.every(t => t.percentage != null) &&
    round2(template.reduce((s, t) => s + Number(t.percentage), 0)) > 0;
  let running = 0;
  const results = template.map(t => {
    const value = round2(usePercentages ? amount * (Number(t.percentage) / 100) : amount / count);
    running = round2(running + value);
    return { installmentNo: t.installmentNo, dueDate: t.dueDate || null, amount: value };
  });
  const diff = round2(amount - running);
  if (results.length && diff !== 0) results[results.length - 1].amount = round2(results[results.length - 1].amount + diff);
  return results;
}

/** Reduces a gross installment schedule by `totalAid`, taken off the LAST installment first and
 *  cascading backward through earlier ones once each is exhausted (e.g. aid of 3,200 against a
 *  final 4,000 installment leaves it at 800; aid of 5,000 zeroes out a 4,000 final installment and
 *  keeps reducing the one before it). No installment amount is ever allowed to go below 0. */
function applyAidToInstallments(targets, totalAid) {
  let remaining = round2(totalAid);
  for (let i = targets.length - 1; i >= 0 && remaining > 0.005; i--) {
    const reduce = Math.min(targets[i].amount, remaining);
    targets[i].amount = round2(targets[i].amount - reduce);
    remaining = round2(remaining - reduce);
  }
  return targets;
}

function computeInstallmentStatus(amount, paidAmount, dueDate) {
  if (paidAmount >= amount - 0.005) return 'paid';
  const overdue = !!dueDate && dueDate < todayStr();
  if (paidAmount > 0.005) return overdue ? 'overdue' : 'partial';
  return overdue ? 'overdue' : 'pending';
}

async function getInstallments(studentId, termId) {
  const rows = await all('SELECT * FROM installments WHERE studentId = ? AND termId = ? ORDER BY installmentNo', [studentId, termId]);
  return rows.map(r => ({ ...r, status: computeInstallmentStatus(r.amount, r.paidAmount, r.dueDate) }));
}
async function getAllInstallments(studentId) {
  const rows = await all('SELECT * FROM installments WHERE studentId = ? ORDER BY termId, installmentNo', [studentId]);
  return rows.map(r => ({ ...r, status: computeInstallmentStatus(r.amount, r.paidAmount, r.dueDate) }));
}

/** Rebuilds a student's installment schedule for one term from scratch: the plan's gross split of
 *  totalCharged, with active aid taken off the last installment and cascading backward (see
 *  applyAidToInstallments) — so the schedule's total always equals netPayable exactly, never the
 *  gross amount. Called after generateCharges and after any aid award/edit/revoke for that term —
 *  safe to call even if nothing changed (idempotent).
 *
 *  Every installment's `amount` is fully recomputed every time — there's no "already settled,
 *  leave it alone" carve-out. What's actually been paid into each slot is a separate concern,
 *  re-derived immediately after by reallocateInstallments() from the student's whole payment
 *  history, so resizing an installment's target (even one that was previously fully paid) never
 *  conflicts with money already applied to it — it just changes how that money is redistributed. */
async function recomputeInstallmentsForStudentTerm(studentId, termId) {
  const charge = await get(`SELECT amount FROM finance_transactions WHERE studentId = ? AND termId = ? AND type = 'charge'`, [studentId, termId]);
  if (!charge) return [];
  const aidRows = await all(`SELECT amount FROM finance_transactions WHERE studentId = ? AND termId = ? AND type = 'aid'`, [studentId, termId]);
  const totalAid = round2(aidRows.reduce((s, r) => s + (r.amount || 0), 0));
  const netPayable = round2(Math.max(0, charge.amount - totalAid));

  const plan = await getFeePlan(termId);
  const grossTargets = splitInstallments(charge.amount, plan);
  const targets = applyAidToInstallments(grossTargets, totalAid);
  // Guard against float drift across the cascade above: force the schedule to sum to exactly
  // netPayable by absorbing any residual cent into the last installment.
  const targetsSum = round2(targets.reduce((s, t) => s + t.amount, 0));
  const residual = round2(netPayable - targetsSum);
  if (targets.length && residual !== 0) targets[targets.length - 1].amount = round2(targets[targets.length - 1].amount + residual);

  const existing = await all('SELECT * FROM installments WHERE studentId = ? AND termId = ?', [studentId, termId]);
  const existingByNo = new Map(existing.map(e => [e.installmentNo, e]));

  for (const target of targets) {
    const cur = existingByNo.get(target.installmentNo);
    if (!cur) {
      await run(
        'INSERT INTO installments (studentId, termId, installmentNo, amount, dueDate, paidAmount, status) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [studentId, termId, target.installmentNo, target.amount, target.dueDate, computeInstallmentStatus(target.amount, 0, target.dueDate)]
      );
      continue;
    }
    await run('UPDATE installments SET amount = ?, dueDate = ? WHERE id = ?', [target.amount, target.dueDate, cur.id]);
  }
  // The fee plan's installment count shrank since a previous generation (or the plan was removed
  // entirely) — drop whatever installments no longer belong to it. Any money already applied to
  // them isn't lost: reallocateInstallments() below replays the student's whole payment history
  // from scratch across whatever installments remain, across every term.
  for (const e of existing) {
    if (!targets.some(t => t.installmentNo === e.installmentNo)) {
      await run('DELETE FROM installments WHERE id = ?', [e.id]);
    }
  }

  // paidAmount/status are never set directly above — reallocateInstallments() is the single place
  // that derives them, by replaying the full payment history against the (now-reconciled) schedule
  // in due-date order (earliest first), across every term.
  await reallocateInstallments(studentId);
  return getInstallments(studentId, termId);
}

/** Replays every recorded payment (oldest first) against every installment (earliest due date
 *  first, across all terms) from scratch — always correct by construction, no incremental
 *  allocate/undo bookkeeping to get out of sync. Also tracks, per source payment, which
 *  installment(s) it ended up covering and how much — this is what a receipt's "payment
 *  allocation" line and reallocateInstallments()'s actual DB update share, so there's exactly one
 *  place that implements the pool-consumption algorithm. */
async function computeAllocationPlan(studentId) {
  const installments = await all(
    'SELECT * FROM installments WHERE studentId = ? ORDER BY (dueDate IS NULL), dueDate, termId, installmentNo',
    [studentId]
  );
  const payments = await all(
    `SELECT amount, relatedPaymentId FROM finance_transactions WHERE studentId = ? AND type = 'payment' ORDER BY createdAt, id`,
    [studentId]
  );
  const pool = payments.map(p => ({ relatedPaymentId: p.relatedPaymentId, remaining: p.amount || 0 }));
  let poolIndex = 0;
  const installmentUpdates = [];
  const allocationsByPayment = new Map();
  for (const inst of installments) {
    let remainingCapacity = inst.amount;
    let allocated = 0;
    while (remainingCapacity > 0.005 && poolIndex < pool.length) {
      const entry = pool[poolIndex];
      if (entry.remaining <= 0.005) { poolIndex++; continue; }
      const take = Math.min(entry.remaining, remainingCapacity);
      entry.remaining -= take;
      remainingCapacity -= take;
      allocated += take;
      if (entry.relatedPaymentId != null) {
        const list = allocationsByPayment.get(entry.relatedPaymentId) || [];
        list.push({ termId: inst.termId, installmentNo: inst.installmentNo, amount: round2(take) });
        allocationsByPayment.set(entry.relatedPaymentId, list);
      }
    }
    installmentUpdates.push({ id: inst.id, amount: inst.amount, dueDate: inst.dueDate, paidAmount: round2(allocated) });
  }
  return { installmentUpdates, allocationsByPayment };
}

async function reallocateInstallments(studentId) {
  const { installmentUpdates } = await computeAllocationPlan(studentId);
  for (const u of installmentUpdates) {
    await run('UPDATE installments SET paidAmount = ?, status = ? WHERE id = ?',
      [u.paidAmount, computeInstallmentStatus(u.amount, u.paidAmount, u.dueDate), u.id]);
  }
}

/** How much of a specific payment ended up covering which installment(s), by the current live
 *  allocation state. Used right after recording a payment (to freeze into its receipt snapshot)
 *  and as a best-effort fallback when reconstructing a receipt that predates snapshotting. */
async function getPaymentAllocation(studentId, paymentId) {
  const { allocationsByPayment } = await computeAllocationPlan(studentId);
  return allocationsByPayment.get(paymentId) || [];
}

/* ------------------------------------- Charge generation ------------------------------------- */

/** Live (unsaved) computation of what a student would owe for a term right now — the per-course
 *  and fixed-fee breakdown generateCharges() snapshots into finance_charge_lines, and what the
 *  statement panel previews before charges have been generated yet. */
async function computeGrossCharge(studentId, termId) {
  // Rate resolution: the most specific fee_rules row for this student's actual
  // program/department/college/student-type (see resolveFeeRule), falling back to the legacy
  // per-term default when no hierarchy rule has been configured — currency always comes from the
  // term-level config, since it isn't something that should vary by program within one term.
  const rule = await resolveFeeRule(studentId, termId);
  const { currency } = await getTermFeeConfig(termId);
  const feePerCredit = rule ? rule.feePerCredit : (await getTermFeeConfig(termId)).feePerCredit;
  const sourceRuleId = rule ? rule.id : null;
  const courses = await all(
    `SELECT c.id, c.code, c.name, c.credits FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE e.studentId = ? AND e.status = 'enrolled' AND c.termId = ? ORDER BY c.code`,
    [studentId, termId]
  );
  const courseLines = courses.map(c => ({
    kind: 'course', refId: c.id, label: `${c.code} — ${c.name}`,
    quantity: c.credits || 0, rate: feePerCredit, amount: round2((c.credits || 0) * feePerCredit),
    sourceRuleId,
  }));
  const tuition = round2(courseLines.reduce((s, l) => s + l.amount, 0));
  const applicable = await applicableFeeItems(studentId, termId);
  const feeLines = applicable.map(f => ({ kind: 'fee_item', refId: f.id, label: f.name, quantity: 1, rate: f.amount, amount: round2(f.amount) }));
  const fixedTotal = round2(feeLines.reduce((s, l) => s + l.amount, 0));
  return {
    currency, feePerCredit, sourceRuleId, courseLines, feeLines, tuition, fixedTotal,
    totalCharged: round2(tuition + fixedTotal), hasEnrollment: courses.length > 0,
  };
}

/** For every student registered in `termId`, snapshots tuition (credits x rate) + applicable
 *  fixed fees as one 'charge' ledger entry (upserted, never duplicated — see the partial unique
 *  index on finance_transactions), regenerates their charge-line breakdown, and rebuilds their
 *  installment schedule. Students with no enrollment in this term are skipped entirely. */
async function generateCharges(termId, actingUser) {
  const config = await getTermFeeConfig(termId);
  const feeItems = await getFeeItems(termId);
  const anyFeeRules = await get('SELECT 1 FROM fee_rules WHERE termId = ? AND isActive = 1 LIMIT 1', [termId]);
  if (!anyFeeRules && !(config.feePerCredit > 0) && feeItems.length === 0) {
    const err = new Error('Configure a fee-per-credit rate (globally, or per college/department/program/student type) or at least one fee item for this term before generating charges.');
    err.status = 400;
    throw err;
  }
  const studentIds = (await all(
    `SELECT DISTINCT e.studentId FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE e.status = 'enrolled' AND c.termId = ?`,
    [termId]
  )).map(r => r.studentId);

  let studentsCharged = 0;
  let totalAmount = 0;
  await transaction(async () => {
    for (const studentId of studentIds) {
      const gross = await computeGrossCharge(studentId, termId);
      if (!gross.hasEnrollment) continue;
      const lineCount = gross.courseLines.length;
      await run(
        `INSERT INTO finance_transactions (studentId, termId, type, amount, description, createdBy)
         VALUES (?, ?, 'charge', ?, ?, ?)
         ON CONFLICT(studentId, termId) WHERE type = 'charge'
         DO UPDATE SET amount = excluded.amount, description = excluded.description, createdAt = CURRENT_TIMESTAMP, createdBy = excluded.createdBy`,
        [studentId, termId, gross.totalCharged, `Tuition (${lineCount} course${lineCount === 1 ? '' : 's'}) + fees`, actingUser?.sub ?? null]
      );
      await run('DELETE FROM finance_charge_lines WHERE studentId = ? AND termId = ?', [studentId, termId]);
      for (const line of [...gross.courseLines, ...gross.feeLines]) {
        await run(
          'INSERT INTO finance_charge_lines (studentId, termId, kind, refId, label, quantity, rate, amount, sourceRuleId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [studentId, termId, line.kind, line.refId, line.label, line.quantity, line.rate, line.amount, line.sourceRuleId ?? null]
        );
      }
      await syncApplicationAid(studentId, termId, actingUser);
      await recomputeInstallmentsForStudentTerm(studentId, termId);
      studentsCharged++;
      totalAmount = round2(totalAmount + gross.totalCharged);
    }
  });
  return { studentsCharged, totalAmount, termId };
}

/* ------------------------------------- Financial aid ------------------------------------- */

const AID_TYPES = ['scholarship', 'grant', 'waiver', 'discount'];
const AID_BASES = ['percentage', 'fixed'];

/** Percentage aid is a percent of tuition only (not fixed fees) — uses the frozen charge-line
 *  tuition once charges exist for this term, or a live computation as a preview before they do. */
async function aidAmountFor(studentId, termId, basis, value) {
  if (basis === 'fixed') return round2(Number(value));
  const row = await get(
    `SELECT COALESCE(SUM(amount), 0) as tuition FROM finance_charge_lines WHERE studentId = ? AND termId = ? AND kind = 'course'`,
    [studentId, termId]
  );
  let tuition = row?.tuition || 0;
  if (!tuition) {
    const gross = await computeGrossCharge(studentId, termId);
    tuition = gross.tuition;
  }
  return round2(tuition * (Number(value) / 100));
}

async function postAidTransaction(aidId, studentId, termId, basis, value, type, reason, actingUser) {
  const amount = await aidAmountFor(studentId, termId, basis, value);
  await run(
    `INSERT INTO finance_transactions (studentId, termId, type, amount, description, relatedAidId, createdBy) VALUES (?, ?, 'aid', ?, ?, ?, ?)`,
    [studentId, termId, amount, `${type}${reason ? ' — ' + reason : ''}`, aidId, actingUser.sub]
  );
  return amount;
}

/** Transaction-free core of awardAid — used directly by syncApplicationAid, which already runs
 *  inside generateCharges's own transaction (the `transaction` helper is a raw BEGIN/COMMIT with
 *  no nesting support, so wrapping again here would error). awardAid below is the transactional
 *  entry point every route handler should keep using. */
async function awardAidInternal(studentId, termId, { type, basis, value, reason, applicationId }, actingUser) {
  const result = await run(
    'INSERT INTO student_financial_aid (studentId, termId, type, basis, value, status, awardedBy, reason, applicationId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [studentId, termId, type, basis, round2(Number(value)), 'active', actingUser.sub, reason ? String(reason).slice(0, 500) : null, applicationId || null]
  );
  await postAidTransaction(result.id, studentId, termId, basis, value, type, reason, actingUser);
  await recomputeInstallmentsForStudentTerm(studentId, termId);
  return get('SELECT * FROM student_financial_aid WHERE id = ?', [result.id]);
}

async function awardAid(studentId, termId, opts, actingUser) {
  return transaction(() => awardAidInternal(studentId, termId, opts, actingUser));
}

/** The aid currently on file on a student's (latest) admissions application — the only place aid
 *  is decided; there's no manual award/revoke UI in Finance anymore. Returns null if there isn't
 *  one, or its aid fields are empty. Shared by syncApplicationAid (applies it for real once charges
 *  are generated for a term) and studentStatement's pre-generation preview below, so a bursar can
 *  see the pending award before ever clicking "Generate charges". */
async function applicationAidFor(studentId) {
  const application = await get(
    `SELECT id, aidType, aidBasis, aidValue, aidReason FROM applications WHERE createdStudentId = ? ORDER BY id DESC LIMIT 1`,
    [studentId]
  );
  if (!application?.aidType || !application.aidBasis || application.aidValue == null) return null;
  return application;
}

/** Keeps a term's financial aid in sync with whatever is currently on file on the student's
 *  admissions application (applications.aidType/aidBasis/aidValue/aidReason) — the only place
 *  aid is now decided; there's no manual award/revoke UI in Finance anymore. Called once per
 *  student from generateCharges(), before installments are (re)computed, so a newly-generated or
 *  regenerated term's bill always reflects the application's current aid figures:
 *   - No application, or its aid fields are empty: revoke any previously auto-applied aid for
 *     this term (the application is the single source of truth — clearing it there clears it here).
 *   - An application-sourced aid award already matches the application's current figures: leave
 *     it alone (idempotent — re-running generateCharges doesn't create a duplicate every time).
 *   - Otherwise (first time, or the application's figures changed since it was last applied):
 *     revoke the stale award, if any, and award a fresh one from the application's current values.
 *  A manually-awarded aid row (applicationId IS NULL, from before this feature existed) is never
 *  touched by this function. */
async function syncApplicationAid(studentId, termId, actingUser) {
  const application = await applicationAidFor(studentId);
  const existing = await get(
    `SELECT * FROM student_financial_aid WHERE studentId = ? AND termId = ? AND applicationId IS NOT NULL AND status = 'active' ORDER BY id DESC LIMIT 1`,
    [studentId, termId]
  );
  if (!application) {
    if (existing) await revokeAidInternal(existing.id);
    return;
  }
  const matches = existing && existing.applicationId === application.id &&
    existing.type === application.aidType && existing.basis === application.aidBasis &&
    round2(existing.value) === round2(Number(application.aidValue));
  if (matches) return;
  if (existing) await revokeAidInternal(existing.id);
  await awardAidInternal(studentId, termId, {
    type: application.aidType, basis: application.aidBasis, value: application.aidValue,
    reason: application.aidReason || null, applicationId: application.id,
  }, actingUser);
}

/** syncApplicationAid only runs as part of generateCharges, so editing an application's aid
 *  fields after that term's charges already exist would otherwise sit inert until someone
 *  regenerates charges — not obvious from the Application screen. Called by the applications
 *  route right after an aid edit: re-syncs every term the student already has a charge for, so an
 *  already-billed student's balance/installments update immediately. Terms with no charges yet
 *  are untouched (they're covered by studentStatement's pre-generation preview instead). */
async function resyncApplicationAidForBilledTerms(studentId, actingUser) {
  const terms = await all(`SELECT DISTINCT termId FROM finance_transactions WHERE studentId = ? AND type = 'charge'`, [studentId]);
  if (!terms.length) return;
  await transaction(async () => {
    for (const { termId } of terms) await syncApplicationAid(studentId, termId, actingUser);
  });
}

async function reviseAid(aidId, { value, reason }, actingUser) {
  const aid = await get('SELECT * FROM student_financial_aid WHERE id = ?', [aidId]);
  if (!aid) return null;
  const newValue = value != null ? round2(Number(value)) : aid.value;
  const newReason = reason !== undefined ? (reason ? String(reason).slice(0, 500) : null) : aid.reason;
  await transaction(async () => {
    await run('UPDATE student_financial_aid SET value = ?, reason = ? WHERE id = ?', [newValue, newReason, aidId]);
    await run(`DELETE FROM finance_transactions WHERE relatedAidId = ? AND type = 'aid'`, [aidId]);
    if (aid.status === 'active') {
      await postAidTransaction(aidId, aid.studentId, aid.termId, aid.basis, newValue, aid.type, newReason, actingUser);
    }
    await recomputeInstallmentsForStudentTerm(aid.studentId, aid.termId);
  });
  return get('SELECT * FROM student_financial_aid WHERE id = ?', [aidId]);
}

/** Transaction-free core of revokeAid — see awardAidInternal's note on why this exists. */
async function revokeAidInternal(aidId) {
  const aid = await get('SELECT * FROM student_financial_aid WHERE id = ?', [aidId]);
  if (!aid) return null;
  await run(`UPDATE student_financial_aid SET status = 'revoked' WHERE id = ?`, [aidId]);
  await run(`DELETE FROM finance_transactions WHERE relatedAidId = ? AND type = 'aid'`, [aidId]);
  await recomputeInstallmentsForStudentTerm(aid.studentId, aid.termId);
  return get('SELECT * FROM student_financial_aid WHERE id = ?', [aidId]);
}

async function revokeAid(aidId) {
  return transaction(() => revokeAidInternal(aidId));
}

/* ------------------------------------- Payments ------------------------------------- */

/** Mirrors a just-inserted payments row into the ledger and reallocates installments. Called
 *  right after the existing INSERT INTO payments in routes/finance.js — that code path (receipt
 *  numbering etc.) is otherwise untouched. */
async function postPaymentTransaction(payment, actingUser) {
  await run(
    `INSERT INTO finance_transactions (studentId, termId, type, amount, method, reference, description, relatedPaymentId, createdBy) VALUES (?, NULL, 'payment', ?, ?, ?, ?, ?, ?)`,
    [payment.studentId, payment.amount, payment.method, payment.reference, payment.note, payment.id, actingUser?.sub ?? payment.createdBy]
  );
  await reallocateInstallments(payment.studentId);
}

/** Removes a voided payment's ledger entry and reallocates installments. Pairs with
 *  routes/finance.js's void endpoint, which keeps the `payments` row itself (flips it to
 *  status='reversed' rather than deleting it) — only the ledger contribution disappears. */
async function reversePaymentTransaction(payment) {
  await run(`DELETE FROM finance_transactions WHERE relatedPaymentId = ?`, [payment.id]);
  await reallocateInstallments(payment.studentId);
}

/* ------------------------------------- Receipts ------------------------------------- */

/** Everything a receipt shows except the two balance figures (record-time vs. reconstructed-later
 *  callers need different balance semantics — see buildReceiptSnapshot/getReceipt below). Student
 *  department/program come from student_profiles: department is the real departments row;
 *  program prefers the real programs link (profile.programId) and falls back to the free-text
 *  `specialization` field for students not yet assigned a real program row. The term is whatever
 *  the payment was recorded against (payments.termId), falling back to whichever term received
 *  the largest share of this payment's actual installment allocation. Invoice number is the real
 *  id of that term's 'charge' ledger row — not a fabricated number. */
async function buildReceiptCore(payment) {
  const student = await get('SELECT id, name, email, idNumber FROM users WHERE id = ?', [payment.studentId]);
  const profile = await get('SELECT departmentId, programId, specialization FROM student_profiles WHERE studentId = ?', [payment.studentId]);
  const department = profile?.departmentId ? await get('SELECT name FROM departments WHERE id = ?', [profile.departmentId]) : null;
  const program = profile?.programId ? await get('SELECT name FROM programs WHERE id = ?', [profile.programId]) : null;

  const allocation = await getPaymentAllocation(payment.studentId, payment.id);
  let termId = payment.termId || null;
  if (!termId && allocation.length) {
    const byTerm = new Map();
    for (const a of allocation) byTerm.set(a.termId, round2((byTerm.get(a.termId) || 0) + a.amount));
    termId = [...byTerm.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  const term = termId ? await get('SELECT id, name, startDate FROM terms WHERE id = ?', [termId]) : null;
  const termNameCache = new Map(term ? [[term.id, term.name]] : []);
  const allocationWithTermNames = [];
  for (const a of allocation) {
    if (!termNameCache.has(a.termId)) {
      const t = await get('SELECT name FROM terms WHERE id = ?', [a.termId]);
      termNameCache.set(a.termId, t?.name || null);
    }
    allocationWithTermNames.push({ termId: a.termId, termName: termNameCache.get(a.termId), installmentNo: a.installmentNo, amount: a.amount });
  }

  let invoiceNo = null;
  if (termId) {
    const chargeRow = await get(`SELECT id FROM finance_transactions WHERE studentId = ? AND termId = ? AND type = 'charge'`, [payment.studentId, termId]);
    if (chargeRow) invoiceNo = `INV-${termId}-${String(chargeRow.id).padStart(6, '0')}`;
  }

  const currency = termId ? (await getTermFeeConfig(termId)).currency : await getCurrency();

  return {
    receiptNo: payment.receiptNo,
    paidAt: payment.paidAt,
    amount: round2(payment.amount),
    method: payment.method,
    reference: payment.reference,
    note: payment.note,
    currency,
    student: student ? { id: student.id, name: student.name, idNumber: student.idNumber, email: student.email } : null,
    department: department?.name || null,
    program: program?.name || profile?.specialization || null,
    term: term ? { id: term.id, name: term.name, academicYear: term.startDate ? term.startDate.slice(0, 4) : null } : null,
    invoiceNo,
    allocation: allocationWithTermNames,
  };
}

/** Freezes a just-recorded payment's full receipt into JSON, to be saved onto its
 *  payments.receiptSnapshot column. `previousBalance`/`previousCredit` are the student's overall
 *  balance the caller captured BEFORE posting this payment's ledger entry (already split via
 *  splitBalance, so never negative); remaining figures are read fresh here (called after posting
 *  + reallocation, so they already reflect this payment) — if this payment overpaid past every
 *  outstanding charge, remainingBalance floors at 0 and remainingCredit carries the excess. */
async function buildReceiptSnapshot(payment, previousBalance, previousCredit) {
  const core = await buildReceiptCore(payment);
  const overall = await computeOverallTotals(payment.studentId);
  const officer = payment.createdBy ? await get('SELECT id, name FROM users WHERE id = ?', [payment.createdBy]) : null;
  return {
    ...core,
    previousBalance: round2(previousBalance),
    previousCredit: round2(previousCredit || 0),
    remainingBalance: overall.balance,
    remainingCredit: overall.creditBalance,
    officer: officer ? { id: officer.id, name: officer.name } : null,
  };
}

/** Returns the full receipt for a payment: its frozen issuance-time snapshot when one exists, or
 *  (for a payment recorded before receiptSnapshot existed) a best-effort reconstruction — flagged
 *  `reconstructed: true` — built from the current ledger. A reconstructed payment that's since
 *  been voided can't recover its point-in-time balance (reversePaymentTransaction deletes its
 *  ledger row, by design, once voided) — its previousBalance/remainingBalance simply come back
 *  null rather than a misleading guess. Status/void metadata is always read live (never frozen):
 *  a receipt's original figures must never change, but whether it's since been reversed is
 *  exactly the kind of thing that SHOULD keep showing current truth. */
async function getReceipt(paymentId) {
  const payment = await get('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment) return null;

  let snapshot;
  let reconstructed = false;
  if (payment.receiptSnapshot) {
    snapshot = JSON.parse(payment.receiptSnapshot);
  } else {
    reconstructed = true;
    const core = await buildReceiptCore(payment);
    const txn = await get(`SELECT id FROM finance_transactions WHERE relatedPaymentId = ? AND type = 'payment'`, [payment.id]);
    let previousBalance = null, previousCredit = null, remainingBalance = null, remainingCredit = null;
    if (txn) {
      const rows = await all(
        `SELECT type, SUM(amount) as total FROM finance_transactions WHERE studentId = ? AND id <= ? GROUP BY type`,
        [payment.studentId, txn.id]
      );
      const by = Object.fromEntries(rows.map(r => [r.type, r.total || 0]));
      const rawRemaining = round2((by.charge || 0) - (by.aid || 0) - (by.payment || 0) + (by.refund || 0) + (by.adjustment || 0));
      const rawPrevious = round2(rawRemaining + payment.amount);
      ({ balance: remainingBalance, creditBalance: remainingCredit } = splitBalance(rawRemaining));
      ({ balance: previousBalance, creditBalance: previousCredit } = splitBalance(rawPrevious));
    }
    const officer = payment.createdBy ? await get('SELECT id, name FROM users WHERE id = ?', [payment.createdBy]) : null;
    snapshot = {
      ...core, previousBalance, previousCredit, remainingBalance, remainingCredit,
      officer: officer ? { id: officer.id, name: officer.name } : null,
    };
  }

  const voidedByUser = payment.voidedBy ? await get('SELECT name FROM users WHERE id = ?', [payment.voidedBy]) : null;
  return {
    paymentId: payment.id,
    studentId: payment.studentId,
    status: payment.status || 'completed',
    voidedAt: payment.voidedAt || null,
    voidedByName: voidedByUser?.name || null,
    reconstructed,
    ...snapshot,
  };
}

/* ------------------------------------- Totals / statement / worklist ------------------------------------- */

/** Overall totals across every term this student has ever been billed for — used for the
 *  financial-hold check and as the fallback when no specific term is requested. */
async function computeOverallTotals(studentId) {
  const rows = await all('SELECT type, SUM(amount) as total FROM finance_transactions WHERE studentId = ? GROUP BY type', [studentId]);
  const by = Object.fromEntries(rows.map(r => [r.type, r.total || 0]));
  const totalCharged = round2(by.charge || 0);
  const totalAid = round2(by.aid || 0);
  const totalPaid = round2(by.payment || 0);
  const totalRefunded = round2(by.refund || 0);
  const totalAdjustment = round2(by.adjustment || 0);
  const netPayable = round2(totalCharged - totalAid);
  const rawBalance = round2(totalCharged - totalAid - totalPaid + totalRefunded + totalAdjustment);
  return { totalCharged, totalAid, totalPaid, totalRefunded, totalAdjustment, netPayable, ...splitBalance(rawBalance) };
}

/** Totals scoped to one term. `charge`/`aid`/`refund`/`adjustment` ledger rows already carry a
 *  termId, so those sum directly; `payment` rows don't (a payment isn't earmarked for a term when
 *  recorded — see finance.js header). Instead this term's "paid" is however much of the payment
 *  pool reallocateInstallments() has actually applied to *this term's* installments — which is
 *  already the authoritative, correct-by-construction answer to "how much of this term's bill is
 *  covered." */
async function computeTermTotals(studentId, termId) {
  const rows = await all(
    `SELECT type, SUM(amount) as total FROM finance_transactions WHERE studentId = ? AND termId = ? AND type IN ('charge','aid','refund','adjustment') GROUP BY type`,
    [studentId, termId]
  );
  const by = Object.fromEntries(rows.map(r => [r.type, r.total || 0]));
  const totalCharged = round2(by.charge || 0);
  const totalAid = round2(by.aid || 0);
  const totalRefunded = round2(by.refund || 0);
  const totalAdjustment = round2(by.adjustment || 0);
  const paidRow = await get('SELECT COALESCE(SUM(paidAmount), 0) as paid FROM installments WHERE studentId = ? AND termId = ?', [studentId, termId]);
  const totalPaid = round2(paidRow?.paid || 0);
  const netPayable = round2(totalCharged - totalAid);
  const rawBalance = round2(totalCharged - totalAid - totalPaid + totalRefunded + totalAdjustment);
  return { totalCharged, totalAid, totalPaid, totalRefunded, totalAdjustment, netPayable, ...splitBalance(rawBalance) };
}

async function computeStudentTotals(studentId, termId) {
  return termId ? computeTermTotals(studentId, termId) : computeOverallTotals(studentId);
}

/** 'not_billed' until a charge has actually been generated for this scope — a student must never
 *  read as 'cleared' simply because nothing has been billed yet. Scoped to `termId` when given,
 *  otherwise across the student's whole history (matching computeStudentTotals's scoping). */
async function studentStatus(studentId, termId, balance) {
  const chargeExists = termId
    ? await get(`SELECT 1 FROM finance_transactions WHERE studentId = ? AND termId = ? AND type = 'charge' LIMIT 1`, [studentId, termId])
    : await get(`SELECT 1 FROM finance_transactions WHERE studentId = ? AND type = 'charge' LIMIT 1`, [studentId]);
  if (!chargeExists) return 'not_billed';
  if (balance <= 0.004) return 'cleared';
  const overdue = termId
    ? await get('SELECT 1 FROM installments WHERE studentId = ? AND termId = ? AND paidAmount < amount - 0.005 AND dueDate IS NOT NULL AND dueDate < ? LIMIT 1', [studentId, termId, todayStr()])
    : await get('SELECT 1 FROM installments WHERE studentId = ? AND paidAmount < amount - 0.005 AND dueDate IS NOT NULL AND dueDate < ? LIMIT 1', [studentId, todayStr()]);
  if (overdue) return 'overdue';
  const anyPaid = termId
    ? await get('SELECT 1 FROM installments WHERE studentId = ? AND termId = ? AND paidAmount > 0.005 LIMIT 1', [studentId, termId])
    : await get(`SELECT 1 FROM finance_transactions WHERE studentId = ? AND type = 'payment' LIMIT 1`, [studentId]);
  return anyPaid ? 'partial' : 'outstanding';
}

/** A student's full financial picture: totals/balance/status scoped to `termId` when given
 *  (aggregate across every term otherwise — see the file header), plus, when `termId` is given,
 *  that term's specific charge breakdown (frozen if generated, a live preview otherwise) and
 *  `hasHold`, which always reflects the aggregate balance regardless of scope. Payments/aid/
 *  installments lists are always the student's full history across every term. */
async function studentStatement(studentId, termId) {
  const totals = await computeStudentTotals(studentId, termId);
  const status = await studentStatus(studentId, termId, totals.balance);
  // A hold reflects the student's TOTAL outstanding obligation, not just the currently-viewed
  // term's — clearing this term's balance shouldn't lift a hold caused by an unpaid prior term.
  const overall = termId ? await computeOverallTotals(studentId) : totals;
  const rawPayments = await all(
    'SELECT id, amount, method, reference, note, receiptNo, paidAt, status FROM payments WHERE studentId = ? ORDER BY paidAt DESC, id DESC',
    [studentId]
  );
  // Which installment(s) each payment actually covered — same computeAllocationPlan() the
  // receipt uses, run once here so the payment-history list can show it too without a second
  // pool-consumption implementation.
  const { allocationsByPayment } = await computeAllocationPlan(studentId);
  const payments = rawPayments.map(p => ({ ...p, allocation: allocationsByPayment.get(p.id) || [] }));
  const scholarships = await getScholarships(studentId);
  const aid = await all(
    `SELECT a.id, a.termId, a.type, a.basis, a.value, a.status, a.reason, a.createdAt, a.awardedBy, u.name as awardedByName
     FROM student_financial_aid a LEFT JOIN users u ON u.id = a.awardedBy WHERE a.studentId = ? ORDER BY a.createdAt DESC`,
    [studentId]
  );
  const installments = await getAllInstallments(studentId);

  let term = null;
  let rate = await getPerCreditFee();
  let currency = await getCurrency();
  if (termId) {
    const config = await getTermFeeConfig(termId);
    const resolvedRule = await resolveFeeRule(studentId, termId);
    rate = resolvedRule ? resolvedRule.feePerCredit : config.feePerCredit;
    currency = config.currency;
    const chargeRow = await get(`SELECT amount, createdAt FROM finance_transactions WHERE studentId = ? AND termId = ? AND type = 'charge'`, [studentId, termId]);
    const generated = !!chargeRow;
    let courseLines, feeLines, totalCharged;
    if (generated) {
      const lines = await all('SELECT kind, refId, label, quantity, rate, amount FROM finance_charge_lines WHERE studentId = ? AND termId = ? ORDER BY id', [studentId, termId]);
      courseLines = lines.filter(l => l.kind === 'course');
      feeLines = lines.filter(l => l.kind === 'fee_item');
      totalCharged = chargeRow.amount;
    } else {
      const gross = await computeGrossCharge(studentId, termId);
      courseLines = gross.courseLines; feeLines = gross.feeLines; totalCharged = gross.totalCharged;
    }
    const termAidRows = await all(`SELECT amount FROM finance_transactions WHERE studentId = ? AND termId = ? AND type = 'aid'`, [studentId, termId]);
    let termAid = round2(termAidRows.reduce((s, r) => s + (r.amount || 0), 0));
    // Before charges (and thus the real aid award) exist for this term, preview whatever aid is
    // currently on file on the student's application — same live-preview treatment totalCharged
    // above already gets — so a pending award is visible without needing "Generate charges" first.
    let pendingAid = null;
    if (!generated) {
      const application = await applicationAidFor(studentId);
      if (application) {
        const amount = await aidAmountFor(studentId, termId, application.aidBasis, application.aidValue);
        pendingAid = { type: application.aidType, basis: application.aidBasis, value: application.aidValue, reason: application.aidReason, amount };
        termAid = round2(termAid + amount);
      }
    }
    term = {
      termId, generated, generatedAt: chargeRow?.createdAt || null,
      courseLines, feeLines, totalCharged,
      totalAid: termAid, netPayable: round2(totalCharged - termAid),
      installments: installments.filter(i => i.termId === termId),
      pendingAid,
    };
  }

  return {
    rate, currency, ...totals, status, hasHold: overall.balance > 0,
    payments, scholarships, aid, installments, term,
  };
}

/** True if this student currently owes money — blocks midterm/final exams (see routes/exams.js). */
async function hasFinancialHold(studentId) {
  const totals = await computeOverallTotals(studentId);
  return totals.balance > 0;
}

/** How many students currently have an aggregate outstanding balance — the same definition as
 *  hasFinancialHold, computed set-wise in one query instead of looping computeOverallTotals per
 *  student (used by the Registrar dashboard's "Registration holds" KPI). This is a FINANCIAL
 *  hold count, not a dedicated registration-blocking hold — nothing today actually prevents a
 *  student with a balance from registering for courses (see hasFinancialHold's callers). */
async function countStudentsWithHold() {
  const row = await get(`
    SELECT COUNT(*) as count FROM (
      SELECT studentId,
             SUM(CASE type
               WHEN 'charge' THEN amount WHEN 'aid' THEN -amount WHEN 'payment' THEN -amount
               WHEN 'refund' THEN amount WHEN 'adjustment' THEN amount ELSE 0 END) as bal
      FROM finance_transactions GROUP BY studentId HAVING bal > 0.005
    )
  `);
  return row?.count || 0;
}

/** The Bursar's worklist — every student with their charged/paid/balance/status, scoped to
 *  `termId` when given (see file header), aggregate across all terms otherwise. When `termId` is
 *  given, also flags whether that term's charges have been generated yet, for the "Generate
 *  charges" workflow. */
async function financeWorklist(termId) {
  const students = await all(`SELECT id as studentId, name, email, idNumber FROM users WHERE role = 'student' ORDER BY name`);
  const chargedSet = termId
    ? new Set((await all(`SELECT studentId FROM finance_transactions WHERE termId = ? AND type = 'charge'`, [termId])).map(r => r.studentId))
    : null;
  const results = [];
  for (const s of students) {
    const totals = await computeStudentTotals(s.studentId, termId);
    const status = await studentStatus(s.studentId, termId, totals.balance);
    const overall = termId ? await computeOverallTotals(s.studentId) : totals;
    results.push({
      studentId: s.studentId, name: s.name, email: s.email, idNumber: s.idNumber,
      ...totals, status, hasHold: overall.balance > 0,
      chargeGeneratedForTerm: chargedSet ? chargedSet.has(s.studentId) : undefined,
    });
  }
  return results;
}

/* ------------------------------------- Bursar overview aggregates ------------------------------------- */

const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];

function agingBucketFor(daysOverdue) {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

/** Every currently-unpaid installment (amount - paidAmount), bucketed by how many days past its
 *  due date it is — an undated installment always reads as 'current' (no due date means nothing
 *  to be overdue against yet). Scoped to `termId` when given, across every term otherwise. */
async function receivablesAging(termId) {
  const rows = await all(
    `SELECT dueDate, amount, paidAmount FROM installments WHERE paidAmount < amount - 0.005 ${termId ? 'AND termId = ?' : ''}`,
    termId ? [termId] : []
  );
  const today = todayStr();
  const byBucket = Object.fromEntries(AGING_BUCKETS.map(b => [b, { bucket: b, amount: 0, count: 0 }]));
  for (const r of rows) {
    const outstanding = round2(r.amount - r.paidAmount);
    if (outstanding <= 0.005) continue;
    let bucket = 'current';
    if (r.dueDate) {
      const days = Math.floor((new Date(today) - new Date(r.dueDate)) / 86400000);
      bucket = agingBucketFor(days);
    }
    byBucket[bucket].amount = round2(byBucket[bucket].amount + outstanding);
    byBucket[bucket].count += 1;
  }
  return AGING_BUCKETS.map(b => byBucket[b]);
}

/** Today's actual cash collection (completed payments recorded today), broken down by method.
 *  Voided-same-day payments are excluded — money that didn't end up staying collected shouldn't
 *  count toward "collected today." Scoped to `termId` via payments.termId when given (set at
 *  record time — see routes/finance.js), unscoped otherwise. */
async function todayCollections(termId) {
  const today = todayStr();
  const rows = await all(
    `SELECT method, amount FROM payments WHERE status = 'completed' AND date(paidAt) = ? ${termId ? 'AND termId = ?' : ''}`,
    termId ? [today, termId] : [today]
  );
  const byMethod = { cash: 0, bank: 0, card: 0, mobile: 0, other: 0 };
  let total = 0;
  for (const r of rows) {
    const m = Object.prototype.hasOwnProperty.call(byMethod, r.method) ? r.method : 'other';
    byMethod[m] = round2(byMethod[m] + (r.amount || 0));
    total = round2(total + (r.amount || 0));
  }
  return { total, count: rows.length, byMethod };
}

/** The last `limit` ledger events worth showing a Bursar at a glance: new bills, payments,
 *  financial aid, refunds, and manual adjustments (voids aren't a separate ledger row — see
 *  reversePaymentTransaction — so a reversed payment instead just carries a live 'reversed'
 *  status here). Scoped to `termId` when given: term-tagged rows (charge/aid/refund/adjustment)
 *  must match it, while payment rows (never term-tagged in the ledger — see file header) are
 *  always included. */
async function recentFinancialActivity(termId, limit = 15) {
  const cap = Math.max(1, Math.min(100, Number(limit) || 15));
  const termClause = termId ? 'AND (ft.termId IS NULL OR ft.termId = ?)' : '';
  const params = termId ? [termId, cap] : [cap];
  const rows = await all(
    `SELECT ft.id, ft.type, ft.amount, ft.method, ft.description, ft.createdAt, ft.studentId,
            s.name as studentName, u.name as createdByName, p.status as paymentStatus,
            p.id as paymentId, p.receiptNo
     FROM finance_transactions ft
     JOIN users s ON s.id = ft.studentId
     LEFT JOIN users u ON u.id = ft.createdBy
     LEFT JOIN payments p ON p.id = ft.relatedPaymentId
     WHERE ft.type IN ('charge','payment','aid','refund','adjustment') ${termClause}
     ORDER BY ft.createdAt DESC, ft.id DESC
     LIMIT ?`,
    params
  );
  return rows.map(r => ({
    id: r.id, type: r.type, amount: r.amount, method: r.method, description: r.description,
    createdAt: r.createdAt, studentId: r.studentId, studentName: r.studentName,
    createdByName: r.createdByName || null,
    status: r.type === 'payment' ? (r.paymentStatus || 'completed') : null,
    paymentId: r.paymentId ?? null, receiptNo: r.receiptNo ?? null,
  }));
}

/** Every student with at least one unpaid, past-due-date installment, aggregated to one row per
 *  student (a student can have several overdue installments across terms — this sums them into a
 *  single actionable balance rather than listing installment rows separately). `daysOverdue` is
 *  the student's single worst (earliest) unpaid due date, since that's what determines how long
 *  they've been delinquent regardless of how many installments have since piled up behind it.
 *  Sorted worst-first (days overdue desc, then amount desc) — this IS the priority order a Bursar
 *  should work the list in, not just a display default. Scoped to `termId` when given. */
async function overdueInstallments(termId) {
  const rows = await all(
    `SELECT i.studentId, u.name, u.idNumber, i.dueDate, (i.amount - i.paidAmount) as outstanding
     FROM installments i
     JOIN users u ON u.id = i.studentId
     WHERE i.paidAmount < i.amount - 0.005 AND i.dueDate IS NOT NULL AND i.dueDate < ? ${termId ? 'AND i.termId = ?' : ''}`,
    termId ? [todayStr(), termId] : [todayStr()]
  );
  const today = todayStr();
  const byStudent = new Map();
  for (const r of rows) {
    const days = Math.floor((new Date(today) - new Date(r.dueDate)) / 86400000);
    const entry = byStudent.get(r.studentId) || {
      studentId: r.studentId, name: r.name, idNumber: r.idNumber,
      amount: 0, installmentCount: 0, oldestDueDate: r.dueDate, daysOverdue: days,
    };
    entry.amount = round2(entry.amount + Math.max(0, r.outstanding));
    entry.installmentCount += 1;
    if (r.dueDate < entry.oldestDueDate) { entry.oldestDueDate = r.dueDate; entry.daysOverdue = days; }
    byStudent.set(r.studentId, entry);
  }
  return [...byStudent.values()].sort((a, b) => b.daysOverdue - a.daysOverdue || b.amount - a.amount);
}

/** Unpaid installments due within the next `days` days (default 30), grouped by due date — the
 *  Bursar's forward-looking collection plan: what's coming due, how many students it touches, and
 *  how much is expected. Scoped to `termId` when given. */
async function upcomingInstallments(termId, days = 30) {
  const today = todayStr();
  const cutoff = new Date(Date.now() + Math.max(1, Number(days) || 30) * 86400000).toISOString().slice(0, 10);
  const rows = await all(
    `SELECT dueDate, COUNT(DISTINCT studentId) as studentCount, SUM(amount - paidAmount) as totalExpected
     FROM installments
     WHERE paidAmount < amount - 0.005 AND dueDate IS NOT NULL AND dueDate >= ? AND dueDate <= ? ${termId ? 'AND termId = ?' : ''}
     GROUP BY dueDate
     ORDER BY dueDate ASC`,
    termId ? [today, cutoff, termId] : [today, cutoff]
  );
  return rows.map(r => ({ dueDate: r.dueDate, studentCount: r.studentCount, totalExpected: round2(r.totalExpected || 0) }));
}

/** Per-term Charged/Collected/Outstanding totals, oldest-to-newest, for every term that has at
 *  least one generated charge — powers the Finance dashboard's "Payment Overview" chart. Same
 *  charged/paid/balance formulas as computeTermTotals, aggregated across every student instead of
 *  one; terms with no charges generated yet are omitted rather than shown as a zero bar. */
async function termSummary(limit = 12) {
  const cap = Math.max(1, Math.min(50, Number(limit) || 12));
  const ledgerRows = await all(
    `SELECT termId, type, SUM(amount) as total FROM finance_transactions
     WHERE termId IS NOT NULL AND type IN ('charge','aid','refund','adjustment')
     GROUP BY termId, type`
  );
  const paidRows = await all(`SELECT termId, COALESCE(SUM(paidAmount), 0) as paid FROM installments GROUP BY termId`);

  const byTerm = new Map();
  for (const r of ledgerRows) {
    if (!byTerm.has(r.termId)) byTerm.set(r.termId, { charged: 0, aid: 0, refund: 0, adjustment: 0, paid: 0 });
    const bucket = byTerm.get(r.termId);
    bucket[r.type === 'charge' ? 'charged' : r.type] = round2(r.total || 0);
  }
  for (const r of paidRows) {
    if (byTerm.has(r.termId)) byTerm.get(r.termId).paid = round2(r.paid || 0);
  }

  const termIds = [...byTerm.keys()].filter(id => byTerm.get(id).charged > 0);
  if (termIds.length === 0) return [];
  const terms = await all(`SELECT id, name, startDate FROM terms WHERE id IN (${termIds.map(() => '?').join(',')})`, termIds);
  const termById = new Map(terms.map(t => [t.id, t]));

  return termIds
    .filter(id => termById.has(id))
    .map(id => {
      const { charged, aid, refund, adjustment, paid } = byTerm.get(id);
      const outstanding = Math.max(0, round2(charged - aid - paid + refund + adjustment));
      return { termId: id, termName: termById.get(id).name, startDate: termById.get(id).startDate, charged, collected: paid, outstanding };
    })
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || a.termId - b.termId)
    .slice(-cap);
}

module.exports = {
  round2,
  getPerCreditFee, getCurrency,
  getTermFeeConfig, setTermFeeConfig,
  FEE_SCOPES, studentHierarchy, resolveFeeRule,
  getFeeRules, createFeeRule, updateFeeRule, deleteFeeRule,
  FEE_TYPES, getFeeItems, createFeeItem, updateFeeItem, deleteFeeItem,
  getFeePlan, setFeePlan,
  computeGrossCharge, generateCharges,
  AID_TYPES, AID_BASES, awardAid, reviseAid, revokeAid, resyncApplicationAidForBilledTerms,
  postPaymentTransaction, reversePaymentTransaction,
  computeStudentTotals, studentStatement, studentStatus, hasFinancialHold, countStudentsWithHold, financeWorklist,
  getInstallments, getAllInstallments,
  buildReceiptSnapshot, getReceipt,
  AGING_BUCKETS, receivablesAging, todayCollections, recentFinancialActivity, termSummary,
  overdueInstallments, upcomingInstallments,
};
