// See mysql.js's header comment — same GenericSqlConnector.js dialect contract.
const { Client } = require('pg');

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function normalizeType(dataType) {
  const t = String(dataType || '').toLowerCase();
  if (t === 'boolean') return 'bool';
  if (/^(integer|bigint|smallint|serial|bigserial|smallserial)$/.test(t)) return 'int';
  if (/^(numeric|decimal|real|double precision)$/.test(t)) return 'float';
  if (t === 'date') return 'date';
  if (t.startsWith('timestamp')) return 'datetime';
  return 'string'; // character varying/text/uuid/json/jsonb and anything unrecognized
}

async function connect(cfg) {
  const client = new Client({
    host: cfg.host,
    port: cfg.port ? Number(cfg.port) : 5432,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
  });
  await client.connect();
  return client;
}

async function listTables(client) {
  const { rows } = await client.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  return rows.map(r => r.name);
}

async function describeTable(client, cfg, table) {
  const { rows: columnRows } = await client.query(
    `SELECT column_name AS name, data_type AS type, is_nullable AS nullable
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  const { rows: pkRows } = await client.query(
    `SELECT kcu.column_name AS name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [table]
  );
  const { rows: fkRows } = await client.query(
    `SELECT kcu.column_name AS column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name = $1`,
    [table]
  );
  const { rows: [{ c: rowCount }] } = await client.query(`SELECT COUNT(*)::int AS c FROM ${quoteIdent(table)}`);

  return {
    columns: columnRows.map(c => ({ name: c.name, type: c.type, nullable: c.nullable === 'YES' })),
    primaryKey: pkRows.map(r => r.name),
    foreignKeys: fkRows.map(fk => ({ column: fk.column_name, referencesTable: fk.referenced_table, referencesColumn: fk.referenced_column })),
    rowCount: Number(rowCount),
  };
}

async function fetchPage(client, table, { offset, limit }) {
  const { rows } = await client.query(`SELECT * FROM ${quoteIdent(table)} LIMIT $1 OFFSET $2`, [limit, offset]);
  return rows;
}

async function close(client) {
  await client.end();
}

module.exports = { quoteIdent, normalizeType, connect, listTables, describeTable, fetchPage, close };
