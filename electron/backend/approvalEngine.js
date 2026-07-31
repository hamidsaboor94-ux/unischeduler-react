/**
 * Generic approval-chain engine: request/step/decision persistence shared by every
 * "submit -> reviewed by an ordered chain of role-owned steps -> approved/rejected" flow
 * (appeals today; leave, readmission, graduation clearance, financial aid, ... later). A flow
 * module calls registerRequestType() once (see appealsFlow.js) with its chain of
 * {order, role, label} steps, an optional canAct() extra authorization check per step, and an
 * optional effect() hook that runs once, on final approval. routes/approvals.js is the one HTTP
 * surface every registered type shares — a new flow needs no new routes, only a new registration.
 *
 * Authorization: only the role owning the request's CURRENT step may decide it (admin always may,
 * mirroring every other role check in this app); the requester may view and cancel their own
 * request at any time before it's finalized. Every decision is written to the audit log here, in
 * the engine, so a flow module can never accidentally skip it.
 */
const { run, get, all, logAudit } = require('./db');
const { createNotification } = require('./notificationTypes');
const { getUserRoles } = require('./authz');

const OPEN_STATUSES = ['In Review', 'Returned'];
const DECISIONS = new Set(['approve', 'reject', 'return']);

// type -> { subjectType, chain: [{order, role, label}], canAct?(reviewer, request, step), effect?(request, decider), label }
const registry = new Map();
const seededTypes = new Set();

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Registers a request type's config in-process. Cheap/synchronous — safe to call at module load
    time, before the database is necessarily ready (its chain is only written to the DB lazily,
    the first time the type is actually used — see ensureChainSeeded()). Calling this again for
    the same type (e.g. on a test file's fresh require) simply replaces the config. */
function registerRequestType(type, { subjectType, chain, canAct, effect, validatePayload, label }) {
  if (!chain?.length) throw new Error(`registerRequestType("${type}") needs at least one chain step`);
  registry.set(type, { subjectType, chain: [...chain].sort((a, b) => a.order - b.order), canAct, effect, validatePayload, label: label || type });
}

function configFor(type) {
  const config = registry.get(type);
  if (!config) throw httpError(400, `"${type}" is not a registered approval request type`);
  return config;
}

/** Idempotently upserts this type's chain into approval_chain_steps the first time it's needed —
    deferred rather than done inside registerRequestType() itself so flow modules can register at
    require-time without racing db.js's init() (which creates the table). */
async function ensureChainSeeded(type) {
  if (seededTypes.has(type)) return;
  const config = configFor(type);
  for (const step of config.chain) {
    await run(
      `INSERT INTO approval_chain_steps (type, stepOrder, role, label) VALUES (?, ?, ?, ?)
       ON CONFLICT(type, stepOrder) DO UPDATE SET role = excluded.role, label = excluded.label`,
      [type, step.order, step.role, step.label || null]
    );
  }
  seededTypes.add(type);
}

async function chainFor(type) {
  await ensureChainSeeded(type);
  return all('SELECT stepOrder, role, label FROM approval_chain_steps WHERE type = ? ORDER BY stepOrder', [type]);
}

async function hydrateRequest(row) {
  if (!row) return null;
  const [decisions, requester, chain] = await Promise.all([
    all(
      `SELECT d.*, u.name as reviewerName FROM approval_decisions d JOIN users u ON u.id = d.reviewerId
       WHERE d.requestId = ? ORDER BY d.id`,
      [row.id]
    ),
    get('SELECT name, idNumber FROM users WHERE id = ?', [row.requestedBy]),
    chainFor(row.type),
  ]);
  return {
    ...row,
    payload: row.payload ? JSON.parse(row.payload) : null,
    decisions, chain,
    requesterName: requester?.name || null,
    requesterIdNumber: requester?.idNumber || null,
  };
}

async function getRequest(id) {
  return hydrateRequest(await get('SELECT * FROM approval_requests WHERE id = ?', [id]));
}

/** Creates a new request at step 1 and notifies nobody yet (the first-step reviewer finds it via
    their pending queue, not a push notification — matches how every other work-queue in this app
    behaves, e.g. admissions applications). */
async function createRequest(type, { subjectId, requestedBy, payload }) {
  const config = configFor(type);
  await chainFor(type);
  if (config.validatePayload) payload = await config.validatePayload(payload, { subjectId, requestedBy });
  const { id } = await run(
    `INSERT INTO approval_requests (type, subjectType, subjectId, requestedBy, payload, currentStepOrder, status)
     VALUES (?, ?, ?, ?, ?, 1, 'In Review')`,
    [type, config.subjectType, subjectId, requestedBy, payload == null ? null : JSON.stringify(payload)]
  );
  await logAudit({ sub: requestedBy }, 'approval-submit', 'approval_requests', id, { type }, null, { status: 'In Review', currentStepOrder: 1 });
  return getRequest(id);
}

async function listMine(userId) {
  const rows = await all('SELECT * FROM approval_requests WHERE requestedBy = ? ORDER BY id DESC', [userId]);
  return Promise.all(rows.map(hydrateRequest));
}

/** Every open request whose CURRENT step's role is one this reviewer holds — a reviewer's queue.
    A type-specific canAct() (e.g. "must be this course's instructor") narrows it further, applied
    in-memory since it may need its own async lookups per request. */
async function listPendingForReviewer(reviewer) {
  const roles = await getUserRoles(reviewer.sub, reviewer.role);
  if (!roles.length) return [];
  const placeholders = roles.map(() => '?').join(',');
  const rows = await all(
    `SELECT r.* FROM approval_requests r
     JOIN approval_chain_steps s ON s.type = r.type AND s.stepOrder = r.currentStepOrder
     WHERE r.status = 'In Review' AND s.role IN (${placeholders})
     ORDER BY r.id`,
    roles
  );
  const hydrated = await Promise.all(rows.map(hydrateRequest));
  if (roles.includes('admin')) return hydrated;
  const filtered = [];
  for (const request of hydrated) {
    if (await canReviewCurrentStep(reviewer, request)) filtered.push(request);
  }
  return filtered;
}

/** True if `reviewer` is currently entitled to decide `request` — its current step's role (or
    admin), plus that type's canAct() narrowing if any. Shared by decide()'s enforcement,
    listPendingForReviewer()'s filtering, and routes/approvals.js's GET-one visibility check. */
async function canReviewCurrentStep(reviewer, request) {
  const config = configFor(request.type);
  const step = request.chain.find(s => s.stepOrder === request.currentStepOrder);
  if (!step) return false;
  const roles = await getUserRoles(reviewer.sub, reviewer.role);
  if (!roles.includes('admin') && !roles.includes(step.role)) return false;
  if (!config.canAct) return true;
  return config.canAct(reviewer, request, step);
}

function statusMessage(config, status, note) {
  const base = `Your ${config.label} request`;
  if (status === 'Approved') return `${base} was approved.`;
  if (status === 'Rejected') return `${base} was rejected.${note ? ` Reason: ${note}` : ''}`;
  if (status === 'Returned') return `${base} was returned for more information.${note ? ` ${note}` : ''}`;
  return `${base} advanced to the next review step.`;
}

/** Records a decision on `requestId`'s current step. Throws a {status} error for every rejection
    path (not found / not open / wrong role / canAct fails / bad decision) so routes/approvals.js
    can turn it straight into the matching HTTP response. */
async function decide(requestId, reviewer, decision, note) {
  if (!DECISIONS.has(decision)) throw httpError(400, 'Invalid decision — must be approve, reject, or return.');
  const request = await getRequest(requestId);
  if (!request) throw httpError(404, 'Not found');
  // 'Returned' is deliberately NOT decidable — it's waiting on the requester to resubmit, not on
  // a reviewer (see resubmit()). Only OPEN_STATUSES (which also includes 'Returned') governs
  // cancel(), since the requester may still withdraw a returned request outright.
  if (request.status !== 'In Review') throw httpError(409, 'This request is no longer open for review.');

  const config = configFor(request.type);
  const step = request.chain.find(s => s.stepOrder === request.currentStepOrder);
  if (!step) throw httpError(500, `"${request.type}" has no chain step ${request.currentStepOrder}`);
  if (!(await canReviewCurrentStep(reviewer, request))) {
    throw httpError(403, 'You do not have permission to act on this request.');
  }

  await run(
    'INSERT INTO approval_decisions (requestId, stepOrder, reviewerId, decision, note) VALUES (?, ?, ?, ?, ?)',
    [requestId, step.stepOrder, reviewer.sub, decision, note || null]
  );

  let newStatus = request.status;
  let newStepOrder = request.currentStepOrder;
  if (decision === 'reject') {
    newStatus = 'Rejected';
  } else if (decision === 'return') {
    newStatus = 'Returned';
  } else {
    const nextStep = request.chain.find(s => s.stepOrder === step.stepOrder + 1);
    newStatus = nextStep ? 'In Review' : 'Approved';
    if (nextStep) newStepOrder = nextStep.stepOrder;
  }

  await run('UPDATE approval_requests SET status = ?, currentStepOrder = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
    [newStatus, newStepOrder, requestId]);
  await logAudit(reviewer, 'approval-decide', 'approval_requests', requestId,
    { type: request.type, decision, stepOrder: step.stepOrder, note: note || null },
    { status: request.status, currentStepOrder: request.currentStepOrder },
    { status: newStatus, currentStepOrder: newStepOrder });

  const updated = await getRequest(requestId);
  if (newStatus === 'Approved' && config.effect) await config.effect(updated, reviewer);
  await createNotification(request.requestedBy, statusMessage(config, newStatus, note), 'approval_status_changed',
    { entityType: 'approval_request', entityId: requestId });

  return getRequest(requestId);
}

/** The requester withdraws their own not-yet-finalized request. */
async function cancel(requestId, user) {
  const request = await getRequest(requestId);
  if (!request) throw httpError(404, 'Not found');
  if (request.requestedBy !== user.sub && user.role !== 'admin') throw httpError(403, 'Forbidden');
  if (!OPEN_STATUSES.includes(request.status)) throw httpError(409, 'This request is no longer open.');
  await run('UPDATE approval_requests SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', ['Cancelled', requestId]);
  await logAudit(user, 'approval-cancel', 'approval_requests', requestId, { type: request.type }, { status: request.status }, { status: 'Cancelled' });
  return getRequest(requestId);
}

/** The requester answers a 'return for info' decision: optionally revises the payload and sends
    the request back into the SAME step's queue (a return is "give me more info", not "start
    over" — the chain doesn't restart from step 1). */
async function resubmit(requestId, user, payload) {
  const request = await getRequest(requestId);
  if (!request) throw httpError(404, 'Not found');
  if (request.requestedBy !== user.sub && user.role !== 'admin') throw httpError(403, 'Forbidden');
  if (request.status !== 'Returned') throw httpError(409, 'Only a returned request can be resubmitted.');
  const config = configFor(request.type);
  if (payload != null && config.validatePayload) payload = await config.validatePayload(payload, { subjectId: request.subjectId, requestedBy: request.requestedBy });
  await run('UPDATE approval_requests SET status = ?, payload = COALESCE(?, payload), updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
    ['In Review', payload == null ? null : JSON.stringify(payload), requestId]);
  await logAudit(user, 'approval-resubmit', 'approval_requests', requestId, { type: request.type }, { status: 'Returned' }, { status: 'In Review' });
  return getRequest(requestId);
}

module.exports = { registerRequestType, createRequest, getRequest, listMine, listPendingForReviewer, canReviewCurrentStep, decide, cancel, resubmit };
