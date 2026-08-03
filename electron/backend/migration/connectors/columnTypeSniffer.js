// Infers a canonical column type for source files with no declared schema (CSV/Excel — unlike a
// SQL source's information_schema, there's nothing to read a real type from). Reuses validators.js's
// own per-type validate* functions so "does this column look like an int" here is answered by the
// exact same rule the Validate/Dry-Run steps apply later to the actual data — no second type
// vocabulary to keep in sync.
const { validateInt, validateFloat, validateBool, validateDatetime } = require('../validators');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Infers one column's canonical type from a sample of its values (empties ignored — an all-empty
    sample falls through to 'string', the safest default). Checked most-specific first so e.g. a
    column of whole numbers sniffs as 'int' rather than the equally-valid-but-looser 'float'. */
function sniffColumnType(sampleValues) {
  const nonEmpty = sampleValues.filter(v => v !== undefined && v !== null && v !== '');
  if (nonEmpty.length === 0) return 'string';
  if (nonEmpty.every(v => validateInt(v, {}) === null)) return 'int';
  if (nonEmpty.every(v => validateFloat(v, {}) === null)) return 'float';
  if (nonEmpty.every(v => validateBool(v, {}) === null)) return 'bool';
  // validators.js's validateDate() falls back to a loose `new Date(s)` parse when a value isn't a
  // strict YYYY-MM-DD string, so it also accepts full datetime strings — useless for telling
  // "date-only" and "datetime" columns apart here. Checked directly via the same strict pattern
  // validateDate() fast-paths on internally, before falling back to the looser datetime check.
  if (nonEmpty.every(v => DATE_ONLY_RE.test(String(v).trim()))) return 'date';
  if (nonEmpty.every(v => validateDatetime(v, {}) === null)) return 'datetime';
  return 'string';
}

/** Builds a SqliteFileConnector-shaped `columns` array (`{name,type,nullable,pk}`) for a raw
    file's header row + a sample of its data rows (`sampleRows[i][j]` = row i, column j — same
    column order as `headers`). Every sniffed column is `nullable: true, pk: false`: raw files
    carry no constraint metadata, and v1 preserves source PKs only for SQL sources, whose
    discover() reports a real primaryKey. */
function sniffColumns(headers, sampleRows) {
  return headers.map((name, i) => ({
    name,
    type: sniffColumnType(sampleRows.map(row => row[i])),
    nullable: true,
    pk: false,
  }));
}

module.exports = { sniffColumnType, sniffColumns };
