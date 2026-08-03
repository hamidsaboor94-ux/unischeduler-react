const fs = require('fs');
const path = require('path');
const { run, get: dbGet, transaction, backupTo, DB_PATH } = require('../../db');
const progress = require('../progress');

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** The one v1 DestinationAdapter — this app's own embedded node:sqlite database. `table` is
    always a hardcoded table name from migration/destinationTargets.js, and `row` keys are always
    field names from that same target's `fields` spec — neither ever comes directly from client
    input, so building SQL by interpolating them follows this codebase's existing
    trusted-identifier convention (see db.js's ensureColumn). */

/** Writes a pre-import snapshot (VACUUM INTO, reusing db.js's existing backupTo()) to a
    timestamped file under a migration-snapshots directory next to the live database. Returns the
    snapshot's path, stored on the migration row so rollback() can fall back to it. */
async function snapshot(migrationId) {
  const dir = path.join(path.dirname(DB_PATH), 'migration-snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `migration-${migrationId}-${Date.now()}.sqlite`);
  await backupTo(dest);
  return dest;
}

// No-ops: bulkInsert already brackets each batch in its own transaction() call, so there's no
// cross-batch transaction for begin()/commit() to bracket. Kept to satisfy the DestinationAdapter
// shape so a future adapter that *does* need one isn't blocked by this interface.
async function begin() {}
async function commit() {}

/** Inserts one already-validated, already-coerced batch of rows into `table`, tagging every row
    with `source_migration_id`. The whole batch is one transaction — see db.js's transaction()
    helper — so a mid-batch failure rolls back that batch only, not the whole migration. */
async function bulkInsert(table, rows, migrationId) {
  return transaction(async () => {
    let inserted = 0;
    for (const row of rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map(() => '?').join(', ');
      const sql = `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}, source_migration_id) ` +
        `VALUES (${placeholders}, ?)`;
      await run(sql, [...columns.map(c => row[c]), migrationId]);
      inserted++;
    }
    return inserted;
  });
}

/** Deletes every row this migration inserted, table by table, in the reverse of the order they
    were imported in (so FK children go before their parents). Caller is expected to fall back to
    restoreFrom(snapshotPath) if this itself throws (e.g. a since-added FK from other app data
    onto a migrated row) — see routes/migrations.js's rollback handler. */
async function rollback(migrationId, tablesInReverseDependencyOrder) {
  return transaction(async () => {
    const deletedCounts = {};
    for (const table of tablesInReverseDependencyOrder) {
      const result = await run(`DELETE FROM ${quoteIdent(table)} WHERE source_migration_id = ?`, [migrationId]);
      deletedCounts[table] = result.changes;
    }
    return deletedCounts;
  });
}

/** Checked at the top of every batch iteration in engine.js's import loop. In-memory flag first
    (progress.js — no DB round trip), migrations.cancelRequested as a fallback in case this
    migration's in-memory entry was lost (server restart) but the row itself was flagged. */
async function cancelCheck(migrationId) {
  if (progress.isCancelRequested(migrationId)) return true;
  const row = await dbGet('SELECT cancelRequested FROM migrations WHERE id = ?', [migrationId]);
  return !!row?.cancelRequested;
}

module.exports = { snapshot, begin, commit, bulkInsert, rollback, cancelCheck };
