/**
 * Safety harness for running write operations — real endpoint code, real queries — without
 * risking the production database. Three pieces: a hard guard that refuses to run against the
 * production DB, an automatic timestamped backup before any run, and a rollback-by-default
 * transactional wrapper.
 *
 * History: this project's only SQLite database was once wiped when a feature-testing session
 * ran destructive admin actions (backup-restore, system-reset) against it, because there was no
 * separate test database. This module is the guardrail so that can't happen again — see
 * PROJECT-PROGRESS.md. Use it for anything that exercises destructive routes (backup/restore,
 * system-reset) or the planned academic-lifecycle simulation.
 */
const fs = require('fs');
const path = require('path');
const { DB_PATH, transaction } = require('./db');

const PRODUCTION_DB_PATH = path.resolve(path.join(__dirname, '..', 'data', 'database.sqlite'));

function currentDbPath() {
  return DB_PATH === ':memory:' ? ':memory:' : path.resolve(DB_PATH);
}

/** Throws if the given path (default: the currently-configured database) resolves to the
    production database. `dbPathOverride` exists so this guard's logic can be exercised in tests
    without ever actually pointing DB_PATH at the real production file. Call this before any
    destructive action or simulation run — never trust a caller to have checked NODE_ENV. */
function assertNotProduction(dbPathOverride) {
  const current = dbPathOverride ? path.resolve(dbPathOverride) : currentDbPath();
  if (current === PRODUCTION_DB_PATH) {
    throw new Error(
      `Refusing to run: "${current}" is the production database. Point DB_PATH at a test ` +
      `database (see scripts/createTestDb.js) before running a simulation or destructive action.`
    );
  }
}

/** Copies the current database file to a timestamped backup alongside it, before any
    destructive/simulation run. No-op for :memory:. Returns the backup file path, or null. */
function backupBeforeRun() {
  const current = currentDbPath();
  if (current === ':memory:') return null;
  const backupDir = path.join(path.dirname(current), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir, `pre-simulation-${stamp}.sqlite`);
  fs.copyFileSync(current, dest);
  return dest;
}

/** Runs `fn` (an async function making db.js run()/get()/all() calls, or hitting real endpoints
    that do) inside a transaction against the currently-configured database. Refuses to run at
    all — before touching anything — if that database is production. Takes an automatic
    timestamped backup first. Defaults to rolling back at the end (dry run); pass
    { commit: true } to actually persist. */
async function runHarness(fn, { commit = false } = {}) {
  assertNotProduction();
  const backupFile = backupBeforeRun();
  const result = await transaction(fn, { commit });
  return { result, committed: commit, backupFile };
}

module.exports = { assertNotProduction, backupBeforeRun, runHarness, PRODUCTION_DB_PATH };
