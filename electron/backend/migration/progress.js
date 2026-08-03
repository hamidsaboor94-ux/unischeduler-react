// In-memory per-migration progress + cancel-flag state. This is the fast path for
// GET /migrations/:id/progress and for engine.js's between-batch cancel check; the `migrations`
// table's own counter columns are the durable fallback (written after every batch commit) for a
// server restart mid-run, or for querying a migration that finished in an earlier process.

const state = new Map(); // migrationId -> counters

function init(migrationId, initial = {}) {
  state.set(migrationId, {
    status: 'running',
    currentTable: null,
    totalTables: 0,
    totalRows: 0,
    processedRows: 0,
    insertedRows: 0,
    errorRows: 0,
    cancelRequested: false,
    ...initial,
  });
}

function update(migrationId, patch) {
  const current = state.get(migrationId) || {};
  state.set(migrationId, { ...current, ...patch });
}

function get(migrationId) {
  return state.get(migrationId) || null;
}

function requestCancel(migrationId) {
  update(migrationId, { cancelRequested: true });
}

function isCancelRequested(migrationId) {
  return !!state.get(migrationId)?.cancelRequested;
}

function clear(migrationId) {
  state.delete(migrationId);
}

/** Used by the "refuse to start if a migration is already running" guardrail, alongside the DB
    query — this in-memory check closes the race window between that SELECT and the row's
    status actually landing as 'running'. */
function isAnyRunning() {
  for (const v of state.values()) {
    if (v.status === 'running') return true;
  }
  return false;
}

module.exports = { init, update, get, requestCancel, isCancelRequested, clear, isAnyRunning };
