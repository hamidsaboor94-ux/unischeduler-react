/**
 * The one HTTP surface every approval-chain request type shares (see ../approvalEngine.js) —
 * appeals today, more flow types later, all without a new route. Authorization is entirely
 * dynamic (current step's role, plus a type's own canAct()), so this mounts bare in app.js
 * (requireAuth only) rather than behind a static requireModuleAccess module gate, same pattern
 * as routes/progression.js and routes/students.js.
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const engine = require('../approvalEngine');

const router = express.Router();

function respondError(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  throw err;
}

// Self-service only for now — subjectId is always the caller. An admin-on-behalf submission path
// can be added when a flow actually needs it (none of Tier 1's appeals does).
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  try {
    const request = await engine.createRequest(req.body?.type, {
      subjectId: req.user.sub, requestedBy: req.user.sub, payload: req.body?.payload,
    });
    res.status(201).json(request);
  } catch (err) { respondError(res, err); }
}));

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  res.json(await engine.listMine(req.user.sub));
}));

router.get('/pending', requireAuth, asyncHandler(async (req, res) => {
  res.json(await engine.listPendingForReviewer(req.user));
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const request = await engine.getRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  const isOwner = request.requestedBy === req.user.sub;
  const wasReviewer = request.decisions.some(d => d.reviewerId === req.user.sub);
  if (!isOwner && req.user.role !== 'admin' && !wasReviewer && !(await engine.canReviewCurrentStep(req.user, request))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(request);
}));

router.post('/:id/decide', requireAuth, asyncHandler(async (req, res) => {
  try {
    res.json(await engine.decide(req.params.id, req.user, req.body?.decision, req.body?.note));
  } catch (err) { respondError(res, err); }
}));

router.post('/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  try {
    res.json(await engine.cancel(req.params.id, req.user));
  } catch (err) { respondError(res, err); }
}));

router.post('/:id/resubmit', requireAuth, asyncHandler(async (req, res) => {
  try {
    res.json(await engine.resubmit(req.params.id, req.user, req.body?.payload));
  } catch (err) { respondError(res, err); }
}));

module.exports = router;
