const express = require('express');
const { all, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json(await all('SELECT * FROM notifications WHERE userId = ? ORDER BY id DESC LIMIT 50', [req.user.sub]));
}));

router.put('/read-all', requireAuth, asyncHandler(async (req, res) => {
  await run('UPDATE notifications SET isRead = 1 WHERE userId = ? AND isRead = 0', [req.user.sub]);
  res.json({ ok: true });
}));

router.put('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  await run('UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?', [req.params.id, req.user.sub]);
  res.json({ ok: true });
}));

module.exports = router;
