// One of three thin per-dialect modules behind GenericSqlConnector.js's uniform interface (the
// other two: postgres.js, mssql.js). Nothing outside GenericSqlConnector.js requires this file
// directly — see its own header comment for the exact method contract every dialect implements.
const mysql = require('mysql2/promise');

function quoteIdent(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

// MySQL's information_schema exposes DATA_TYPE (e.g. "int", "tinyint", "varchar") and the fuller
// COLUMN_TYPE (e.g. "tinyint(1)", "int(11) unsigned") — only COLUMN_TYPE distinguishes a real
// TINYINT column from MySQL's conventional boolean encoding (TINYINT(1)), so describeTable() below
// passes COLUMN_TYPE here as `columnType`, not the bare DATA_TYPE.
function normalizeType(columnType) {
  const t = String(columnType || '').toLowerCase();
  if (t.startsWith('tinyint(1)')) return 'bool';
  if (/^(tinyint|smallint|mediumint|int|bigint)/.test(t)) return 'int';
  if (/^(decimal|numeric|float|double)/.test(t)) return 'float';
  if (t.startsWith('datetime') || t.startsWith('timestamp')) return 'datetime';
  if (t.startsWith('date')) return 'date';
  return 'string'; // char/varchar/text/enum/set/json/blob and anything unrecognized
}

async function connect(cfg) {
  return mysql.createConnection({
    host: cfg.host,
    port: cfg.port ? Number(cfg.port) : 3306,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
  });
}

async function listTables(conn, cfg) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS name FROM information_schema.tables
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [cfg.database]
  );
  return rows.map(r => r.name);
}

async function describeTable(conn, cfg, table) {
  const [columnRows] = await conn.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable
     FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [cfg.database, table]
  );
  const [pkRows] = await conn.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.key_column_usage
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`,
    [cfg.database, table]
  );
  const [fkRows] = await conn.query(
    `SELECT COLUMN_NAME AS column_name, REFERENCED_TABLE_NAME AS referenced_table, REFERENCED_COLUMN_NAME AS referenced_column
     FROM information_schema.key_column_usage
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [cfg.database, table]
  );
  const [[{ c: rowCount }]] = await conn.query(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`);

  return {
    columns: columnRows.map(c => ({ name: c.name, type: c.type, nullable: c.nullable === 'YES' })),
    primaryKey: pkRows.map(r => r.name),
    foreignKeys: fkRows.map(fk => ({ column: fk.column_name, referencesTable: fk.referenced_table, referencesColumn: fk.referenced_column })),
    rowCount: Number(rowCount),
  };
}

async function fetchPage(conn, table, { offset, limit }) {
  const [rows] = await conn.query(`SELECT * FROM ${quoteIdent(table)} LIMIT ? OFFSET ?`, [limit, offset]);
  return rows;
}

async function close(conn) {
  await conn.end();
}

module.exports = { quoteIdent, normalizeType, connect, listTables, describeTable, fetchPage, close };
