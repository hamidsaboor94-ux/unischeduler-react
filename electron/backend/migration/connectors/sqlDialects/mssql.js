// See mysql.js's header comment — same GenericSqlConnector.js dialect contract.
const sql = require('mssql');

function quoteIdent(name) {
  return `[${String(name).replace(/]/g, ']]')}]`;
}

function normalizeType(dataType) {
  const t = String(dataType || '').toLowerCase();
  if (t === 'bit') return 'bool';
  if (/^(tinyint|smallint|int|bigint)$/.test(t)) return 'int';
  if (/^(decimal|numeric|float|real|money|smallmoney)$/.test(t)) return 'float';
  if (t === 'date') return 'date';
  if (/^(datetime|datetime2|smalldatetime|datetimeoffset)$/.test(t)) return 'datetime';
  return 'string'; // char/varchar/nvarchar/text/uniqueidentifier and anything unrecognized
}

// A per-connection pool (not `sql.connect()`'s shared global default) so concurrent connectors —
// e.g. a saved-connection test alongside an in-progress migration — never fight over one pool.
async function connect(cfg) {
  const pool = new sql.ConnectionPool({
    server: cfg.host,
    port: cfg.port ? Number(cfg.port) : 1433,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: { trustServerCertificate: true, encrypt: cfg.encrypt !== false },
  });
  await pool.connect();
  return pool;
}

async function listTables(pool) {
  const result = await pool.request().query(
    `SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`
  );
  return result.recordset.map(r => r.name);
}

async function describeTable(pool, cfg, table) {
  const columnResult = await pool.request().input('table', sql.NVarChar, table).query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable
     FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table ORDER BY ORDINAL_POSITION`
  );
  const pkResult = await pool.request().input('table', sql.NVarChar, table).query(
    `SELECT ku.COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
     WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_NAME = @table
     ORDER BY ku.ORDINAL_POSITION`
  );
  const fkResult = await pool.request().input('table', sql.NVarChar, table).query(
    `SELECT kcu1.COLUMN_NAME AS column_name, kcu2.TABLE_NAME AS referenced_table, kcu2.COLUMN_NAME AS referenced_column
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu1 ON rc.CONSTRAINT_NAME = kcu1.CONSTRAINT_NAME
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2 ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
     WHERE kcu1.TABLE_NAME = @table`
  );
  const countResult = await pool.request().query(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`);

  return {
    columns: columnResult.recordset.map(c => ({ name: c.name, type: c.type, nullable: c.nullable === 'YES' })),
    primaryKey: pkResult.recordset.map(r => r.name),
    foreignKeys: fkResult.recordset.map(fk => ({ column: fk.column_name, referencesTable: fk.referenced_table, referencesColumn: fk.referenced_column })),
    rowCount: Number(countResult.recordset[0].c),
  };
}

// SQL Server's OFFSET/FETCH requires an ORDER BY; `(SELECT NULL)` is the standard way to page
// without asserting a real sort column — same "no guaranteed ordering across pages" contract
// SqliteFileConnector's own plain `SELECT * FROM table` already has (see its readRows()).
async function fetchPage(pool, table, { offset, limit }) {
  const result = await pool.request().input('offset', sql.Int, offset).input('limit', sql.Int, limit).query(
    `SELECT * FROM ${quoteIdent(table)} ORDER BY (SELECT NULL) OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`
  );
  return result.recordset;
}

async function close(pool) {
  await pool.close();
}

module.exports = { quoteIdent, normalizeType, connect, listTables, describeTable, fetchPage, close };
