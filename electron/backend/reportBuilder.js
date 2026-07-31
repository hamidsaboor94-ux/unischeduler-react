/**
 * Deterministic custom report builder: turns a whitelisted {entity, columns, filters, groupBy,
 * aggregate, sort} config (see reportEntities.js) into a parameterized SQL query and runs it. No
 * raw SQL, table name, or column name ever comes from the client — every expression is looked up
 * by `key` in ENTITIES; only filter/sort VALUES flow into the query, always as `?` params.
 *
 * Two shapes of result:
 *  - no groupBy: a flat row table over the selected columns (the "custom report").
 *  - groupBy set: one row per group (`groupLabel`, `count`, optional `aggregateValue`), plus a
 *    ready-to-render `chart` block — this is the "basic chart" the builder promises.
 */
const { all } = require('./db');
const { ENTITIES, OPERATORS_BY_TYPE } = require('./reportEntities');

const ROW_CAP = 2000;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function entityFor(entityKey) {
  const entity = ENTITIES[entityKey];
  if (!entity) throw httpError(400, `Unknown report entity "${entityKey}"`);
  return entity;
}

function buildFilterClause(expr, type, op, value, params) {
  if (!OPERATORS_BY_TYPE[type].includes(op)) return null;
  switch (op) {
    case 'equals':
      if (value === undefined || value === null || value === '') return null;
      params.push(value);
      return `${expr} = ?`;
    case 'contains':
      if (!value) return null;
      params.push(`%${value}%`);
      return `${expr} LIKE ?`;
    case 'gt': params.push(value); return `${expr} > ?`;
    case 'gte': params.push(value); return `${expr} >= ?`;
    case 'lt': params.push(value); return `${expr} < ?`;
    case 'lte': params.push(value); return `${expr} <= ?`;
    case 'before': params.push(value); return `${expr} < ?`;
    case 'after': params.push(value); return `${expr} > ?`;
    case 'between': {
      if (!Array.isArray(value) || value.length !== 2) return null;
      params.push(value[0], value[1]);
      return `${expr} BETWEEN ? AND ?`;
    }
    case 'in': {
      if (!Array.isArray(value) || !value.length) return null;
      params.push(...value);
      return `${expr} IN (${value.map(() => '?').join(', ')})`;
    }
    default:
      return null;
  }
}

/** Builds { sql, params, columns, groupBy, aggregate } from a whitelisted config. Throws
    httpError(400, ...) on anything unrecognized rather than silently dropping it, except
    individual filter rows referencing an unknown field/op — those are dropped, matching how a
    stale saved definition (a field later removed) should degrade rather than 400 on every run. */
function buildQuery(entityKey, config = {}) {
  const entity = entityFor(entityKey);
  const requested = Array.isArray(config.columns) && config.columns.length ? config.columns : Object.keys(entity.fields);
  const columns = requested.filter((c) => entity.fields[c]);
  if (!columns.length) throw httpError(400, 'Select at least one valid column.');

  const groupBy = config.groupBy && entity.fields[config.groupBy]?.groupable ? config.groupBy : null;
  const aggregate = groupBy && config.aggregate
    && entity.fields[config.aggregate.field]?.type === 'number'
    && ['sum', 'avg'].includes(config.aggregate.fn)
    ? config.aggregate
    : null;

  const params = [];
  const whereClauses = [];
  for (const f of (Array.isArray(config.filters) ? config.filters : [])) {
    const field = entity.fields[f?.field];
    if (!field) continue;
    const clause = buildFilterClause(field.expr, field.type, f.op, f.value, params);
    if (clause) whereClauses.push(clause);
  }
  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  let selectSql, groupSql = '', orderSql, resultColumns;
  if (groupBy) {
    const groupField = entity.fields[groupBy];
    const parts = [`${groupField.expr} AS groupLabel`, 'COUNT(*) AS count'];
    resultColumns = ['groupLabel', 'count'];
    if (aggregate) {
      parts.push(`${aggregate.fn.toUpperCase()}(${entity.fields[aggregate.field].expr}) AS aggregateValue`);
      resultColumns.push('aggregateValue');
    }
    selectSql = parts.join(', ');
    groupSql = `GROUP BY ${groupField.expr}`;
    orderSql = 'ORDER BY count DESC';
  } else {
    selectSql = columns.map((c) => `${entity.fields[c].expr} AS "${c}"`).join(', ');
    resultColumns = columns;
    if (config.sort && entity.fields[config.sort.field]) {
      const dir = config.sort.dir === 'desc' ? 'DESC' : 'ASC';
      orderSql = `ORDER BY ${entity.fields[config.sort.field].expr} ${dir}`;
    } else {
      orderSql = '';
    }
  }

  const limit = Math.max(1, Math.min(Number(config.limit) || ROW_CAP, ROW_CAP));
  params.push(limit);
  const sql = `SELECT ${selectSql} FROM ${entity.from} ${whereSql} ${groupSql} ${orderSql} LIMIT ?`.replace(/\s+/g, ' ').trim();

  return { sql, params, columns: resultColumns, groupBy, aggregate, limit };
}

async function runReport(entityKey, config = {}) {
  const entity = entityFor(entityKey);
  const { sql, params, columns, groupBy, aggregate, limit } = buildQuery(entityKey, config);
  const rows = await all(sql, params);

  const columnMeta = columns.map((key) => {
    if (key === 'groupLabel') return { key, label: entity.fields[groupBy].label };
    if (key === 'count') return { key, label: 'Count' };
    if (key === 'aggregateValue') return { key, label: `${aggregate.fn === 'sum' ? 'Sum' : 'Average'} of ${entity.fields[aggregate.field].label}` };
    return { key, label: entity.fields[key].label };
  });

  const chart = groupBy ? {
    type: entity.fields[groupBy].type === 'date' ? 'line' : 'bar',
    data: rows.map((r) => ({ label: r.groupLabel ?? '—', value: aggregate ? r.aggregateValue : r.count })),
  } : null;

  return { entity: entityKey, columns: columnMeta, rows, chart, truncated: rows.length >= limit };
}

module.exports = { buildQuery, runReport, httpError };
