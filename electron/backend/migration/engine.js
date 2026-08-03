// The import engine — knows neither a concrete SourceConnector nor DestinationAdapter type. It
// only ever calls methods on the objects registry.getConnector()/destinationTargets.getTarget()
// hand back, so a new source type or a second adapter never requires a change here.
const { run, get: dbGet, all: dbAll } = require('../db');
const registry = require('./registry');
const destinationTargets = require('./destinationTargets');
const adapter = require('./adapters/SqliteDestinationAdapter');
const crypto = require('./crypto');
const { validateRow } = require('./validators');
const progress = require('./progress');

const BATCH_SIZE = 500;
const MAX_LOGGED_ERRORS_PER_TABLE = 200;

// Only one migration (dry run or real import) runs at a time, process-wide — set synchronously
// before the first `await` in processMigration() so two near-simultaneous POST /start calls can't
// both pass the check (closes the race the route's own DB-row check alone can't).
let runningMigrationId = null;

function isRunning() {
  return runningMigrationId !== null;
}

/** Topologically sorts a set of destination-target keys by their `dependsOn` graph
    (destinationTargets.js). A dependency not present in `targetKeys` is simply skipped — not
    every migration maps every target, so "departments depends on colleges" shouldn't force
    colleges into the order when this run never mapped it. Throws on a cycle: dependsOn is a
    fixed registry property, never client input, so a cycle is a bug worth failing loudly on. */
function topoSort(targetKeys) {
  const keys = [...new Set(targetKeys)];
  const visited = new Set();
  const visiting = new Set();
  const order = [];
  function visit(key) {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`Circular dependency detected involving "${key}"`);
    visiting.add(key);
    const target = destinationTargets.getTarget(key);
    for (const dep of (target?.dependsOn || [])) {
      if (keys.includes(dep)) visit(dep);
    }
    visiting.delete(key);
    visited.add(key);
    order.push(key);
  }
  for (const key of keys) visit(key);
  return order;
}

/** Assigns each mapping row its resolved topological `importOrder`, ascending. Used by
    POST /migrations/:id/mapping right before saving. */
function resolveImportOrder(mappings) {
  const order = topoSort(mappings.map(m => m.destinationTarget));
  const positionOf = new Map(order.map((key, i) => [key, i]));
  return mappings
    .map(m => ({ ...m, importOrder: positionOf.get(m.destinationTarget) ?? 0 }))
    .slice()
    .sort((a, b) => a.importOrder - b.importOrder);
}

/** Resolves the config object passed to registry.getConnector() — either a saved, decrypted
    connection (remote SQL sources) or the staged upload path (file sources: sqlite/csv/excel). */
async function buildConnectorConfig(migrationRow) {
  if (migrationRow.sourceFilePath) {
    return { filePath: migrationRow.sourceFilePath, originalName: migrationRow.sourceFileName };
  }
  if (!migrationRow.connectionId) {
    throw new Error('Migration has no source file or connection configured');
  }
  const conn = await dbGet('SELECT * FROM migration_connections WHERE id = ?', [migrationRow.connectionId]);
  if (!conn) throw new Error('Saved connection not found');
  const config = JSON.parse(conn.configJson);
  const password = conn.encryptedPassword ? crypto.decrypt(conn.encryptedPassword) : undefined;
  return { ...config, password };
}

async function runDiscovery(migrationId) {
  const migrationRow = await dbGet('SELECT * FROM migrations WHERE id = ?', [migrationId]);
  if (!migrationRow) throw new Error('Migration not found');
  await run('UPDATE migrations SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', ['discovering', migrationId]);

  const cfg = await buildConnectorConfig(migrationRow);
  const connector = registry.getConnector(migrationRow.sourceType, cfg);
  try {
    await connector.connect();
    const tables = await connector.discover();
    await run(
      'UPDATE migrations SET status = ?, discoverySnapshotJson = ?, totalTables = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      ['discovered', JSON.stringify(tables), tables.length, migrationId]
    );
    return tables;
  } catch (err) {
    await run('UPDATE migrations SET status = ?, errorMessage = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', ['failed', err.message, migrationId]);
    throw err;
  } finally {
    await connector.close();
  }
}

/** Structural checks for the Validate wizard step — distinct from the row-level checks Dry Run
    performs over actual data. Confirms every enabled mapping is worth spending a full data pass
    on: required fields are mapped, the destination target is empty (v1's "assume empty target"
    guardrail — destinationTargets.js's isEmpty()), and every dependency a mapped target declares
    is either itself mapped (so topoSort/resolveImportOrder will import it first) or already has
    live data to satisfy the FK. Never touches source data, so it's safe to re-run cheaply after
    every mapping edit. */
async function validateMappings(migrationId) {
  const migrationRow = await dbGet('SELECT * FROM migrations WHERE id = ?', [migrationId]);
  if (!migrationRow) throw new Error('Migration not found');
  const mappingRows = await dbAll(
    'SELECT * FROM migration_mappings WHERE migrationId = ? AND enabled = 1',
    [migrationId]
  );

  const errors = [];
  if (mappingRows.length === 0) {
    errors.push({ sourceTable: null, message: 'No enabled mappings — map at least one source table before validating.' });
  }

  const mappedTargetKeys = new Set(mappingRows.map(m => m.destinationTarget));
  for (const mapping of mappingRows) {
    const target = destinationTargets.getTarget(mapping.destinationTarget);
    if (!target) {
      errors.push({ sourceTable: mapping.sourceTable, message: `Unknown destination target "${mapping.destinationTarget}"` });
      continue;
    }
    const columnMap = JSON.parse(mapping.columnMapJson);
    for (const [field, spec] of Object.entries(target.fields)) {
      if (spec.required && !columnMap[field]) {
        errors.push({ sourceTable: mapping.sourceTable, message: `Required field "${field}" (target "${target.label}") is not mapped` });
      }
    }
    if (!(await target.isEmpty())) {
      errors.push({ sourceTable: mapping.sourceTable, message: `Destination target "${target.label}" already has rows — v1 only imports into an empty target` });
    }
    for (const dep of target.dependsOn || []) {
      if (mappedTargetKeys.has(dep)) continue;
      const depTarget = destinationTargets.getTarget(dep);
      if (depTarget && !(await depTarget.isEmpty())) continue; // satisfied by existing live data
      errors.push({
        sourceTable: mapping.sourceTable,
        message: `Target "${target.label}" depends on "${depTarget ? depTarget.label : dep}", which is not mapped and has no existing data`,
      });
    }
  }

  const valid = errors.length === 0;
  if (valid) {
    await run('UPDATE migrations SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', ['validated', migrationId]);
  }
  return { valid, errors };
}

function applyMapping(sourceRow, columnMap) {
  const mapped = {};
  for (const [destField, sourceColumn] of Object.entries(columnMap || {})) {
    if (sourceColumn) mapped[destField] = sourceRow[sourceColumn];
  }
  return mapped;
}

async function finalizeStatus(migrationId, status, errorMessage = null) {
  progress.update(migrationId, { status });
  await run(
    'UPDATE migrations SET status = ?, errorMessage = ?, finishedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
    [status, errorMessage, migrationId]
  );
}

/** The shared batch loop behind both the dry run and the real import — identical validation and
    row-by-row accounting either way; the only difference is whether target.write() (a real
    insert) is called for a batch's valid rows. */
async function runBody(migrationId, { dryRun }) {
  try {
    const migrationRow = await dbGet('SELECT * FROM migrations WHERE id = ?', [migrationId]);
    if (!migrationRow) throw new Error('Migration not found');
    const mappingRows = await dbAll(
      'SELECT * FROM migration_mappings WHERE migrationId = ? AND enabled = 1 ORDER BY importOrder ASC',
      [migrationId]
    );
    if (mappingRows.length === 0) throw new Error('No enabled mappings to import');

    if (!dryRun) {
      const snapshotPath = await adapter.snapshot(migrationId);
      await run('UPDATE migrations SET snapshotPath = ? WHERE id = ?', [snapshotPath, migrationId]);
    }

    const discoveredTables = migrationRow.discoverySnapshotJson ? JSON.parse(migrationRow.discoverySnapshotJson) : [];
    const rowCountBySourceTable = new Map(discoveredTables.map(t => [t.name, t.rowCount]));
    const totalRows = mappingRows.reduce((sum, m) => sum + (rowCountBySourceTable.get(m.sourceTable) || 0), 0);

    progress.init(migrationId, { status: 'running', totalTables: mappingRows.length, totalRows });
    await run(
      `UPDATE migrations SET status = 'running', startedAt = CURRENT_TIMESTAMP, totalTables = ?, totalRows = ?,
       processedRows = 0, insertedRows = 0, errorRows = 0, cancelRequested = 0, currentTable = NULL,
       updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [mappingRows.length, totalRows, migrationId]
    );

    const cfg = await buildConnectorConfig(migrationRow);

    for (const mapping of mappingRows) {
      const target = destinationTargets.getTarget(mapping.destinationTarget);
      if (!target) {
        await run(
          `INSERT INTO migration_logs (migrationId, level, sourceTable, message, phase) VALUES (?, 'error', ?, ?, ?)`,
          [migrationId, mapping.sourceTable, `Unknown destination target "${mapping.destinationTarget}"`, dryRun ? 'dry_run' : 'import']
        );
        continue;
      }
      const columnMap = JSON.parse(mapping.columnMapJson);

      progress.update(migrationId, { currentTable: mapping.sourceTable });
      await run('UPDATE migrations SET currentTable = ? WHERE id = ?', [mapping.sourceTable, migrationId]);

      const connector = registry.getConnector(migrationRow.sourceType, cfg);
      let loggedErrorsForTable = 0;
      let batchNumber = 0;
      await connector.connect();
      try {
        for await (const batch of connector.readRows(mapping.sourceTable, { batchSize: BATCH_SIZE })) {
          batchNumber++;

          if (await adapter.cancelCheck(migrationId)) {
            await finalizeStatus(migrationId, 'cancelled');
            return;
          }

          const validRows = [];
          let batchErrorCount = 0;
          for (const sourceRow of batch) {
            const mappedRow = applyMapping(sourceRow, columnMap);
            const { valid, errors, values } = validateRow(mappedRow, target.fields);
            if (valid) {
              validRows.push(values);
            } else {
              batchErrorCount++;
              if (loggedErrorsForTable < MAX_LOGGED_ERRORS_PER_TABLE) {
                loggedErrorsForTable++;
                await run(
                  `INSERT INTO migration_logs (migrationId, level, sourceTable, sourceRowRef, message, detailsJson, phase)
                   VALUES (?, 'error', ?, ?, ?, ?, ?)`,
                  [
                    migrationId, mapping.sourceTable, JSON.stringify(sourceRow[Object.keys(sourceRow)[0]] ?? null),
                    errors.map(e => `${e.field}: ${e.message}`).join('; '), JSON.stringify(errors), dryRun ? 'dry_run' : 'import',
                  ]
                );
              }
            }
          }

          const insertedCount = dryRun
            ? validRows.length
            : (validRows.length > 0 ? await target.write(validRows, migrationId) : 0);

          await run(
            `INSERT INTO migration_batches
             (migrationId, sourceTable, destinationTarget, batchNumber, rowCount, insertedCount, errorCount, status, phase, startedAt, finishedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'committed', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [migrationId, mapping.sourceTable, mapping.destinationTarget, batchNumber, batch.length, insertedCount, batchErrorCount, dryRun ? 'dry_run' : 'import']
          );

          const counters = progress.get(migrationId) || {};
          const updated = {
            processedRows: (counters.processedRows || 0) + batch.length,
            insertedRows: (counters.insertedRows || 0) + insertedCount,
            errorRows: (counters.errorRows || 0) + batchErrorCount,
          };
          progress.update(migrationId, updated);
          await run(
            'UPDATE migrations SET processedRows = ?, insertedRows = ?, errorRows = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
            [updated.processedRows, updated.insertedRows, updated.errorRows, migrationId]
          );

          // Yields control back to the event loop between batches so GET /progress and
          // POST /cancel — queued behind this synchronous SQLite work — get serviced.
          await new Promise(setImmediate);
        }
      } finally {
        await connector.close();
      }
    }

    await finalizeStatus(migrationId, dryRun ? 'dry_run' : 'completed');
  } catch (err) {
    await finalizeStatus(migrationId, 'failed', err.message);
    throw err;
  }
}

async function processMigration(migrationId, { dryRun }) {
  if (runningMigrationId !== null) {
    throw new Error('Another migration is already running');
  }
  runningMigrationId = migrationId;
  try {
    await runBody(migrationId, { dryRun });
  } finally {
    runningMigrationId = null;
  }
}

/** Fire-and-forget entry points — callers (routes/migrations.js) invoke these WITHOUT awaiting
    and respond 202 immediately. Errors are already persisted to the migrations row by runBody();
    this catch is only a safety net against an unhandled promise rejection. */
async function runImport(migrationId) {
  try {
    await processMigration(migrationId, { dryRun: false });
  } catch (err) {
    console.error(`Migration ${migrationId} import failed:`, err.message);
  }
}

async function runDryRun(migrationId) {
  try {
    await processMigration(migrationId, { dryRun: true });
  } catch (err) {
    console.error(`Migration ${migrationId} dry run failed:`, err.message);
  }
}

async function requestCancel(migrationId) {
  progress.requestCancel(migrationId);
  await run('UPDATE migrations SET cancelRequested = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [migrationId]);
}

module.exports = {
  topoSort,
  resolveImportOrder,
  runDiscovery,
  validateMappings,
  runDryRun,
  runImport,
  requestCancel,
  isRunning,
};
