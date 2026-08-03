const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { run, get: dbGet, all: dbAll, logAudit, restoreFrom, DB_PATH } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const registry = require('../migration/registry');
const destinationTargets = require('../migration/destinationTargets');
const engine = require('../migration/engine');
const adapter = require('../migration/adapters/SqliteDestinationAdapter');
const crypto = require('../migration/crypto');
const progress = require('../migration/progress');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });

// Belt-and-suspenders on top of app.js's mount-level `requireModuleAccess('dataMigration')`
// (whose empty POLICY row already makes it admin-only) — same double-guard convention
// routes/backup.js uses for the other super-admin-only, high-blast-radius feature in this app.
const admin = [requireAuth, requireRole('admin')];

const UPLOAD_EXTENSIONS = { sqlite: '.sqlite', csv: '.csv', excel: '.xlsx' };

function uploadDir() {
  const dir = path.join(path.dirname(DB_PATH), 'migration-uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function formatConnection(row) {
  if (!row) return null;
  const { encryptedPassword, configJson, ...rest } = row;
  return { ...rest, config: JSON.parse(configJson), hasPassword: !!encryptedPassword };
}

function formatMigrationSummary(row) {
  const { discoverySnapshotJson, lastDryRunSummaryJson, ...rest } = row;
  return rest;
}

function formatMigrationDetail(row) {
  return {
    ...row,
    discoverySnapshotJson: undefined,
    lastDryRunSummaryJson: undefined,
    discoveredTables: row.discoverySnapshotJson ? JSON.parse(row.discoverySnapshotJson) : null,
    lastDryRunSummary: row.lastDryRunSummaryJson ? JSON.parse(row.lastDryRunSummaryJson) : null,
  };
}

async function requireMigration(req, res) {
  const row = await dbGet('SELECT * FROM migrations WHERE id = ?', [Number(req.params.id)]);
  if (!row) {
    res.status(404).json({ error: 'Migration not found' });
    return null;
  }
  return row;
}

/** Resolves the config object handed to registry.getConnector() for /connections/:id/test and
    /:id/discover-adjacent flows — decrypts the saved password the same way engine.js's own
    buildConnectorConfig() does. */
async function connectorConfigForConnection(connectionId) {
  const conn = await dbGet('SELECT * FROM migration_connections WHERE id = ?', [connectionId]);
  if (!conn) throw Object.assign(new Error('Saved connection not found'), { status: 404 });
  const config = JSON.parse(conn.configJson);
  const password = conn.encryptedPassword ? crypto.decrypt(conn.encryptedPassword) : undefined;
  return { sourceType: conn.sourceType, cfg: { ...config, password } };
}

// ---------------------------------------------------------------------------
// Saved connections
// ---------------------------------------------------------------------------

router.get('/connections', ...admin, asyncHandler(async (req, res) => {
  const rows = await dbAll('SELECT * FROM migration_connections ORDER BY createdAt DESC');
  res.json(rows.map(formatConnection));
}));

router.post('/connections', ...admin, asyncHandler(async (req, res) => {
  const { label, sourceType, config, password } = req.body || {};
  if (!label || !sourceType) return res.status(400).json({ error: 'label and sourceType are required' });
  if (!registry.listSourceTypes().includes(sourceType)) {
    return res.status(400).json({ error: `Unsupported source type "${sourceType}"` });
  }
  const { password: _drop, ...safeConfig } = config || {};
  const encryptedPassword = password ? crypto.encrypt(password) : null;
  const { id } = await run(
    'INSERT INTO migration_connections (label, sourceType, configJson, encryptedPassword, createdBy) VALUES (?, ?, ?, ?, ?)',
    [label, sourceType, JSON.stringify(safeConfig), encryptedPassword, req.user.sub]
  );
  await logAudit(req.user, 'create', 'migration_connection', id, { label, sourceType });
  res.status(201).json(formatConnection(await dbGet('SELECT * FROM migration_connections WHERE id = ?', [id])));
}));

router.put('/connections/:id', ...admin, asyncHandler(async (req, res) => {
  const existing = await dbGet('SELECT * FROM migration_connections WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Connection not found' });
  const { label, config, password } = req.body || {};
  const baseConfig = config || JSON.parse(existing.configJson);
  const { password: _drop, ...safeConfig } = baseConfig;
  const encryptedPassword = password ? crypto.encrypt(password) : existing.encryptedPassword;
  await run(
    'UPDATE migration_connections SET label = ?, configJson = ?, encryptedPassword = ? WHERE id = ?',
    [label ?? existing.label, JSON.stringify(safeConfig), encryptedPassword, existing.id]
  );
  await logAudit(req.user, 'update', 'migration_connection', existing.id, { label: label ?? existing.label });
  res.json(formatConnection(await dbGet('SELECT * FROM migration_connections WHERE id = ?', [existing.id])));
}));

router.delete('/connections/:id', ...admin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const inUse = await dbGet(
    "SELECT id FROM migrations WHERE connectionId = ? AND status NOT IN ('completed','failed','cancelled','rolled_back')",
    [id]
  );
  if (inUse) return res.status(409).json({ error: 'This connection is in use by an in-progress migration' });
  const { changes } = await run('DELETE FROM migration_connections WHERE id = ?', [id]);
  if (!changes) return res.status(404).json({ error: 'Connection not found' });
  await logAudit(req.user, 'delete', 'migration_connection', id, null);
  res.json({ ok: true });
}));

// Tests a not-yet-saved config — the password travels in the request body only, never persisted.
router.post('/connections/test', ...admin, asyncHandler(async (req, res) => {
  const { sourceType, config } = req.body || {};
  if (!sourceType) return res.status(400).json({ error: 'sourceType is required' });
  try {
    const connector = registry.getConnector(sourceType, config || {});
    await connector.connect();
    await connector.close();
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
}));

router.post('/connections/:id/test', ...admin, asyncHandler(async (req, res) => {
  try {
    const { sourceType, cfg } = await connectorConfigForConnection(Number(req.params.id));
    const connector = registry.getConnector(sourceType, cfg);
    await connector.connect();
    await connector.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 200).json({ ok: false, error: err.message });
  }
}));

// ---------------------------------------------------------------------------
// Reference data for the wizard's dropdowns
// ---------------------------------------------------------------------------

router.get('/targets', ...admin, asyncHandler(async (req, res) => {
  res.json(destinationTargets.listTargets());
}));

router.get('/source-types', ...admin, asyncHandler(async (req, res) => {
  res.json(registry.listSourceTypes());
}));

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

router.get('/', ...admin, asyncHandler(async (req, res) => {
  const rows = await dbAll('SELECT * FROM migrations ORDER BY createdAt DESC');
  res.json(rows.map(formatMigrationSummary));
}));

router.get('/:id', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  res.json(formatMigrationDetail(row));
}));

// Create a migration against a saved SQL connection.
router.post('/', ...admin, asyncHandler(async (req, res) => {
  const { label, connectionId } = req.body || {};
  const conn = await dbGet('SELECT * FROM migration_connections WHERE id = ?', [connectionId]);
  if (!conn) return res.status(400).json({ error: 'connectionId does not reference a saved connection' });
  const { id } = await run(
    'INSERT INTO migrations (label, sourceType, connectionId, status, createdBy) VALUES (?, ?, ?, ?, ?)',
    [label || conn.label, conn.sourceType, conn.id, 'draft', req.user.sub]
  );
  await logAudit(req.user, 'create', 'migration', id, { sourceType: conn.sourceType, connectionId: conn.id });
  res.status(201).json(formatMigrationDetail(await dbGet('SELECT * FROM migrations WHERE id = ?', [id])));
}));

// Create a migration from an uploaded file (sqlite/csv/excel). Written to a durable directory —
// unlike routes/backup.js's throwaway tempFile(), this file must survive until Import finishes.
router.post('/upload', ...admin, upload.single('file'), asyncHandler(async (req, res) => {
  const { label, sourceType } = req.body || {};
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = UPLOAD_EXTENSIONS[sourceType];
  if (!ext) return res.status(400).json({ error: 'sourceType must be one of: sqlite, csv, excel' });

  const { id } = await run(
    'INSERT INTO migrations (label, sourceType, sourceFileName, status, createdBy) VALUES (?, ?, ?, ?, ?)',
    [label || req.file.originalname, sourceType, req.file.originalname, 'draft', req.user.sub]
  );
  const destPath = path.join(uploadDir(), `migration-${id}${ext}`);
  fs.writeFileSync(destPath, req.file.buffer);
  await run('UPDATE migrations SET sourceFilePath = ? WHERE id = ?', [destPath, id]);

  await logAudit(req.user, 'create', 'migration', id, { sourceType, fileName: req.file.originalname, sizeBytes: req.file.buffer.length });
  res.status(201).json(formatMigrationDetail(await dbGet('SELECT * FROM migrations WHERE id = ?', [id])));
}));

router.post('/:id/discover', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  try {
    const tables = await engine.runDiscovery(row.id);
    await logAudit(req.user, 'discover', 'migration', row.id, { tableCount: tables.length });
    res.json({ tables });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

router.get('/:id/mapping', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  const saved = await dbAll('SELECT * FROM migration_mappings WHERE migrationId = ? ORDER BY importOrder ASC', [row.id]);
  if (saved.length > 0) {
    return res.json(saved.map(m => ({ ...m, columnMap: JSON.parse(m.columnMapJson), columnMapJson: undefined })));
  }
  // Nothing saved yet — suggest a default mapping per discovered table against every target
  // whose fields look like a plausible match, so the Map Columns step never starts blank.
  const discoveredTables = row.discoverySnapshotJson ? JSON.parse(row.discoverySnapshotJson) : [];
  const suggestions = discoveredTables.map(table => {
    const best = destinationTargets.listTargets()
      .map(t => ({ target: t, map: destinationTargets.suggestColumnMap(table, t.fields) }))
      .sort((a, b) => Object.keys(b.map).length - Object.keys(a.map).length)[0];
    return {
      sourceTable: table.name,
      destinationTarget: best && Object.keys(best.map).length > 0 ? best.target.key : null,
      columnMap: best ? best.map : {},
      enabled: !!(best && Object.keys(best.map).length > 0),
    };
  });
  res.json(suggestions);
}));

router.post('/:id/mapping', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  if (row.status === 'running') return res.status(409).json({ error: 'Cannot edit the mapping while this migration is running' });

  const mappings = Array.isArray(req.body) ? req.body : null;
  if (!mappings) return res.status(400).json({ error: 'Body must be an array of mappings' });
  for (const m of mappings) {
    if (!m.sourceTable || !m.destinationTarget) return res.status(400).json({ error: 'Each mapping needs sourceTable and destinationTarget' });
    if (m.enabled !== false && !destinationTargets.getTarget(m.destinationTarget)) {
      return res.status(400).json({ error: `Unknown destination target "${m.destinationTarget}"` });
    }
  }

  const ordered = engine.resolveImportOrder(mappings.filter(m => m.enabled !== false))
    .concat(mappings.filter(m => m.enabled === false).map(m => ({ ...m, importOrder: 0 })));

  await run('DELETE FROM migration_mappings WHERE migrationId = ?', [row.id]);
  for (const m of ordered) {
    await run(
      `INSERT INTO migration_mappings (migrationId, sourceTable, destinationTarget, columnMapJson, importOrder, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, m.sourceTable, m.destinationTarget, JSON.stringify(m.columnMap || {}), m.importOrder || 0, m.enabled === false ? 0 : 1]
    );
  }
  await run('UPDATE migrations SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', ['mapped', row.id]);
  await logAudit(req.user, 'map', 'migration', row.id, { tableCount: ordered.length });
  res.json({ ok: true });
}));

router.post('/:id/validate', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  if (row.status === 'running') return res.status(409).json({ error: 'This migration is currently running' });
  const result = await engine.validateMappings(row.id);
  await logAudit(req.user, 'validate', 'migration', row.id, { valid: result.valid, errorCount: result.errors.length });
  // Always 200 — an invalid mapping is validate() doing its job correctly, not a malformed
  // request. A 400 here would make api.js's shared error handling throw and discard the response
  // body, losing the per-field `errors` array the frontend needs to actually show the problem.
  res.json(result);
}));

router.post('/:id/dry-run', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  if (engine.isRunning()) return res.status(409).json({ error: 'Another migration is already running' });
  if (!['validated', 'dry_run', 'failed'].includes(row.status)) {
    return res.status(400).json({ error: `Run Validate first (current status: ${row.status})` });
  }
  await logAudit(req.user, 'dry_run', 'migration', row.id, null);
  engine.runDryRun(row.id); // fire-and-forget — client polls GET /:id/progress
  res.status(202).json({ status: 'running' });
}));

router.post('/:id/import', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  if (engine.isRunning()) return res.status(409).json({ error: 'Another migration is already running' });
  if (!['dry_run', 'failed'].includes(row.status)) {
    return res.status(400).json({ error: `Run a dry run first (current status: ${row.status})` });
  }
  await logAudit(req.user, 'import', 'migration', row.id, null);
  engine.runImport(row.id); // fire-and-forget — client polls GET /:id/progress
  res.status(202).json({ status: 'running' });
}));

router.get('/:id/progress', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  const inMemory = progress.get(row.id);
  res.json(inMemory || {
    status: row.status,
    currentTable: row.currentTable,
    totalTables: row.totalTables,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    insertedRows: row.insertedRows,
    errorRows: row.errorRows,
    cancelRequested: !!row.cancelRequested,
  });
}));

router.post('/:id/cancel', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  if (row.status !== 'running') return res.status(400).json({ error: 'This migration is not running' });
  await engine.requestCancel(row.id);
  await logAudit(req.user, 'cancel', 'migration', row.id, null);
  res.json({ ok: true });
}));

router.get('/:id/report', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  // Only the real import's own batches/logs — a migration dry-run (possibly more than once)
  // before importing writes to these same tables (see migration/engine.js's runBody()), and
  // mixing those transient rows into the final report would misrepresent what actually happened.
  const batches = await dbAll("SELECT * FROM migration_batches WHERE migrationId = ? AND phase = 'import' ORDER BY id ASC", [row.id]);
  const logs = await dbAll("SELECT * FROM migration_logs WHERE migrationId = ? AND phase = 'import' ORDER BY id ASC", [row.id]);
  res.json({
    migration: formatMigrationSummary(row),
    batches,
    logs: logs.map(l => ({ ...l, detailsJson: undefined, details: l.detailsJson ? JSON.parse(l.detailsJson) : null })),
  });
}));

// Deletes every row this migration inserted (tag-based, reverse dependency order); falls back to
// restoring the pre-import snapshot — replacing the ENTIRE live database, not just this
// migration's rows — if the tag-based delete itself fails (e.g. a since-added FK onto a migrated
// row). SqliteDestinationAdapter.rollback()'s own header comment calls for exactly this fallback.
router.post('/:id/rollback', ...admin, asyncHandler(async (req, res) => {
  const row = await requireMigration(req, res);
  if (!row) return;
  if (row.status !== 'completed') return res.status(400).json({ error: 'Only a completed migration can be rolled back' });

  const mappingRows = await dbAll(
    'SELECT * FROM migration_mappings WHERE migrationId = ? AND enabled = 1 ORDER BY importOrder DESC',
    [row.id]
  );
  const tables = [];
  for (const m of mappingRows) {
    const target = destinationTargets.getTarget(m.destinationTarget);
    for (const t of (target?.tables || [])) if (!tables.includes(t)) tables.push(t);
  }

  try {
    const deletedCounts = await adapter.rollback(row.id, tables);
    await run('UPDATE migrations SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', ['rolled_back', row.id]);
    await logAudit(req.user, 'rollback', 'migration', row.id, { method: 'delete', deletedCounts });
    res.json({ ok: true, method: 'delete', deletedCounts });
  } catch (err) {
    if (!row.snapshotPath) throw err;
    await restoreFrom(row.snapshotPath);
    await run('UPDATE migrations SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', ['rolled_back', row.id]);
    await logAudit(req.user, 'rollback', 'migration', row.id, { method: 'snapshot_restore', snapshotPath: row.snapshotPath, deleteError: err.message });
    res.json({ ok: true, method: 'snapshot_restore' });
  }
}));

module.exports = router;
