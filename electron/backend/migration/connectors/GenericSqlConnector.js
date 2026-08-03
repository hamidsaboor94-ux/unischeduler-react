// SourceConnector over any live SQL database, parameterized by `cfg.driver` — the piece that lets
// registry.js/engine.js support MySQL/Postgres/SQL Server without ever branching on which one.
// Each dialect module (sqlDialects/*.js) supplies identifier quoting, a type-normalization map to
// the same canonical type set SqliteFileConnector.normalizeType() uses, and the raw
// connect/listTables/describeTable/fetchPage primitives; this file composes them into the same
// four-method shape (connect/discover/readRows/close) every SourceConnector implements. Oracle is
// deliberately not one of the dialects here (no Oracle native client — out of v1 scope).
const DIALECTS = {
  mysql: require('./sqlDialects/mysql'),
  postgres: require('./sqlDialects/postgres'),
  mssql: require('./sqlDialects/mssql'),
};

function createGenericSqlConnector(cfg) {
  const dialect = DIALECTS[cfg.driver];
  if (!dialect) throw new Error(`Unsupported SQL driver "${cfg.driver}"`);
  let rawConn = null;

  async function connect() {
    rawConn = await dialect.connect(cfg);
  }

  async function discover() {
    const tableNames = await dialect.listTables(rawConn, cfg);
    const tables = [];
    for (const name of tableNames) {
      // eslint-disable-next-line no-await-in-loop -- one small metadata round trip per table; the
      // same sequential-by-table shape SqliteFileConnector.discover() uses.
      const described = await dialect.describeTable(rawConn, cfg, name);
      const primaryKey = described.primaryKey;
      tables.push({
        name,
        rowCount: described.rowCount,
        primaryKey,
        columns: described.columns.map(c => ({
          name: c.name,
          type: dialect.normalizeType(c.type),
          nullable: c.nullable,
          pk: primaryKey.includes(c.name),
        })),
        foreignKeys: described.foreignKeys,
      });
    }
    return tables;
  }

  async function* readRows(table, { batchSize = 500 } = {}) {
    let offset = 0;
    for (;;) {
      const rows = await dialect.fetchPage(rawConn, table, { offset, limit: batchSize });
      if (rows.length === 0) return;
      yield rows;
      if (rows.length < batchSize) return;
      offset += batchSize;
    }
  }

  async function close() {
    if (rawConn) {
      await dialect.close(rawConn);
      rawConn = null;
    }
  }

  return { connect, discover, readRows, close };
}

module.exports = createGenericSqlConnector;
