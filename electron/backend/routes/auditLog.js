const express = require('express');
const { all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const rows = await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);
  res.json(rows);
}));

module.exports = router;
