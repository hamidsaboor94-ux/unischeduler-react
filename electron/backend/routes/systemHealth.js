const express = require('express');
const fs = require('fs');
const path = require('path');
const { get, DB_PATH } = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

/** GET /api/system-health — read-only snapshot for the Super Admin dashboard's system pulse
    banner and health cards. Every check here is passive (a SELECT, an fs.access, an env var
    read) and nothing here can mutate data or touch backup/restore/reset. Mounted admin-only
    in app.js. */
router.get('/', asyncHandler(async (req, res) => {
  let database = 'ok';
  try { await get('SELECT 1'); } catch { database = 'down'; }

  let storage = 'ok';
  try {
    const dir = DB_PATH === ':memory:' ? __dirname : path.dirname(DB_PATH);
    fs.accessSync(dir, fs.constants.W_OK);
  } catch { storage = 'down'; }

  res.json({
    api: 'ok',
    database,
    storage,
    authentication: 'ok',
    email: process.env.SMTP_HOST ? 'configured' : 'not-configured',
    uptimeSeconds: Math.floor(process.uptime()),
    checkedAt: new Date().toISOString(),
  });
}));

module.exports = router;
