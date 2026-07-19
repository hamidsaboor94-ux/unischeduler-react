const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

/** Translates common SQLite constraint failures into friendly 4xx messages. */
function friendlyConstraintError(err, table) {
  if (!err || !err.message) return null;
  if (err.message.includes('UNIQUE constraint failed')) {
    const column = err.message.split('.').pop();
    return { status: 409, error: `A ${table.slice(0, -1)} with that ${column} already exists.` };
  }
  if (err.message.includes('FOREIGN KEY constraint failed')) {
    return { status: 400, error: 'One or more referenced records (e.g. department, room, teacher, term) do not exist.' };
  }
  return null;
}

/** Runs a write, converting known constraint failures into a friendly response instead of rethrowing to the 500 handler. */
async function runOrFriendlyError(res, table, fn) {
  try {
    return await fn();
  } catch (err) {
    const friendly = friendlyConstraintError(err, table);
    if (friendly) { res.status(friendly.status).json({ error: friendly.error }); return undefined; }
    throw err;
  }
}

/**
 * Builds a standard list/get/create/update/delete router for a reference-data
 * table. Reads are open to any authenticated user; writes are admin-only.
 * `guardDelete(id)` may return an error message string to block a delete
 * (e.g. "still in use"), or null/undefined to allow it.
 * `validate(body)` may return an error message string to reject a create/update
 * (e.g. bad field values), or null/undefined to allow it.
 */
function crudRouter({ table, fields, guardDelete, validate }) {
  const router = express.Router();

  router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const rows = await all(`SELECT * FROM ${table}`);
    res.json(rows);
  }));

  router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
    const row = await get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  }));

  router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    const cols = fields.filter(f => req.body[f] !== undefined);
    if (!cols.length) return res.status(400).json({ error: 'No fields provided' });
    if (validate) {
      const msg = validate(req.body);
      if (msg) return res.status(400).json({ error: msg });
    }
    const result = await runOrFriendlyError(res, table, () => run(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(c => req.body[c])
    ));
    if (result === undefined) return; // response already sent by runOrFriendlyError
    const row = await get(`SELECT * FROM ${table} WHERE id = ?`, [result.id]);
    await logAudit(req.user, 'create', table, result.id, req.body);
    res.status(201).json(row);
  }));

  router.put('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    const cols = fields.filter(f => req.body[f] !== undefined);
    if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
    if (validate) {
      const msg = validate(req.body);
      if (msg) return res.status(400).json({ error: msg });
    }
    const result = await runOrFriendlyError(res, table, () => run(
      `UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map(c => req.body[c]), req.params.id]
    ));
    if (result === undefined) return;
    const row = await get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await logAudit(req.user, 'update', table, req.params.id, req.body);
    res.json(row);
  }));

  router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    if (guardDelete) {
      const msg = await guardDelete(req.params.id);
      if (msg) return res.status(409).json({ error: msg });
    }
    await run(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
    await logAudit(req.user, 'delete', table, req.params.id, null);
    res.status(204).end();
  }));

  return router;
}

module.exports = crudRouter;
module.exports.friendlyConstraintError = friendlyConstraintError;
module.exports.runOrFriendlyError = runOrFriendlyError;
