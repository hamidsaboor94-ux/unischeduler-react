// Pure per-canonical-type validation + coercion, shared by the Validate step, the dry run, and
// the real import (migration/engine.js calls validateRow() in all three places — this is the
// "one shared validator" the Data Migration Center spec calls for). Canonical types are the
// small set every SourceConnector's discover() normalizes source-specific column types down to.

function isEmpty(v) {
  return v === undefined || v === null || v === '';
}

function validateString(v, { required = false } = {}) {
  if (isEmpty(v)) return required ? 'Required' : null;
  return null;
}
function coerceString(v) {
  return isEmpty(v) ? null : String(v);
}

function validateInt(v, { required = false } = {}) {
  if (isEmpty(v)) return required ? 'Required' : null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Must be a whole number';
  return null;
}
function coerceInt(v) {
  return isEmpty(v) ? null : Math.trunc(Number(v));
}

function validateFloat(v, { required = false } = {}) {
  if (isEmpty(v)) return required ? 'Required' : null;
  if (!Number.isFinite(Number(v))) return 'Must be a number';
  return null;
}
function coerceFloat(v) {
  return isEmpty(v) ? null : Number(v);
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n']);
function validateBool(v, { required = false } = {}) {
  if (isEmpty(v)) return required ? 'Required' : null;
  if (typeof v === 'boolean') return null;
  const s = String(v).trim().toLowerCase();
  if (TRUE_VALUES.has(s) || FALSE_VALUES.has(s)) return null;
  return 'Must be a boolean (true/false, 1/0, yes/no)';
}
function coerceBool(v) {
  if (isEmpty(v)) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return TRUE_VALUES.has(String(v).trim().toLowerCase()) ? 1 : 0;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validateDate(v, { required = false } = {}) {
  if (isEmpty(v)) return required ? 'Required' : null;
  const s = String(v).trim();
  const d = DATE_RE.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) return 'Must be a valid date';
  return null;
}
function coerceDate(v) {
  if (isEmpty(v)) return null;
  const s = String(v).trim();
  const d = DATE_RE.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  return d.toISOString().slice(0, 10);
}

function validateDatetime(v, { required = false } = {}) {
  if (isEmpty(v)) return required ? 'Required' : null;
  const d = new Date(String(v).trim());
  if (Number.isNaN(d.getTime())) return 'Must be a valid date/time';
  return null;
}
function coerceDatetime(v) {
  if (isEmpty(v)) return null;
  return new Date(String(v).trim()).toISOString();
}

const VALIDATORS = {
  string: validateString,
  int: validateInt,
  float: validateFloat,
  bool: validateBool,
  date: validateDate,
  datetime: validateDatetime,
};
const COERCERS = {
  string: coerceString,
  int: coerceInt,
  float: coerceFloat,
  bool: coerceBool,
  date: coerceDate,
  datetime: coerceDatetime,
};

/** Validates every field of one already-mapped row (destination field name -> raw source value)
    against a destination target's `fields` spec ({ fieldName: { type, required } }, see
    migration/destinationTargets.js). Returns { valid, errors: [{field, message}], values } —
    `values` holds the coerced, insert-ready value for every valid field (present even when
    `valid` is false, for the fields that did pass, so partial-row diagnostics stay possible). */
function validateRow(mappedRow, targetFields) {
  const errors = [];
  const values = {};
  for (const [field, spec] of Object.entries(targetFields)) {
    const type = spec.type || 'string';
    const validator = VALIDATORS[type];
    if (!validator) {
      errors.push({ field, message: `Unknown canonical type "${type}"` });
      continue;
    }
    const raw = mappedRow[field];
    const message = validator(raw, spec);
    if (message) {
      errors.push({ field, message });
      continue;
    }
    values[field] = COERCERS[type](raw);
  }
  return { valid: errors.length === 0, errors, values };
}

module.exports = {
  VALIDATORS,
  validateRow,
  validateString,
  validateInt,
  validateFloat,
  validateBool,
  validateDate,
  validateDatetime,
  coerceString,
  coerceInt,
  coerceFloat,
  coerceBool,
  coerceDate,
  coerceDatetime,
};
