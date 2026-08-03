const { DatabaseSync } = require('node:sqlite');

// SQLite storage/declared types are free-form text (e.g. "VARCHAR(50)", "DATETIME") rather than a
// fixed enum, so this maps by substring the same way every GenericSqlConnector dialect will.
function normalizeType(declaredType) {
  const t = String(declaredType || '').toUpperCase();
  if (/BOOL/.test(t)) return 'bool';
  if (/INT/.test(t)) return 'int';
  if (/DATETIME|TIMESTAMP/.test(t)) return 'datetime';
  if (/DATE/.test(t)) return 'date';
  if (/REAL|FLOA|DOUB|NUMERIC|DECIMAL/.test(t)) return 'float';
  return 'string'; // CHAR/CLOB/TEXT and anything unrecognized
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** SourceConnector over another SQLite file (e.g. an exported legacy database). Read-only —
    never writes to the uploaded file. cfg: { filePath }. */
function createSqliteFileConnector(cfg) {
  let db = null;

  async function connect() {
    db = new DatabaseSync(cfg.filePath, { readOnly: true });
  }

  async function discover() {
    const tableRows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all();

    return tableRows.map(({ name }) => {
      const columnRows = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all();
      const fkRows = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(name)})`).all();
      const { c: rowCount } = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(name)}`).get();

      const columns = columnRows
        .sort((a, b) => a.cid - b.cid)
        .map(c => ({
          name: c.name,
          type: normalizeType(c.type),
          nullable: c.notnull === 0,
          pk: c.pk > 0,
        }));
      const primaryKey = columnRows
        .filter(c => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map(c => c.name);
      const foreignKeys = fkRows.map(fk => ({
        column: fk.from,
        referencesTable: fk.table,
        referencesColumn: fk.to,
      }));

      return { name, rowCount: Number(rowCount), primaryKey, columns, foreignKeys };
    });
  }

  async function* readRows(table, { batchSize = 500 } = {}) {
    const stmt = db.prepare(`SELECT * FROM ${quoteIdent(table)}`);
    let batch = [];
    for (const row of stmt.iterate()) {
      batch.push({ ...row }); // strip node:sqlite's null-prototype wrapper
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
  }

  async function close() {
    if (db) { db.close(); db = null; }
  }

  return { connect, discover, readRows, close };
}

module.exports = createSqliteFileConnector;
