// The registry of importable destination targets. A "target" generalizes "table" so the one
// real-world complication (a migrated student/teacher fans out across users + a profile table)
// can be absorbed here, behind a uniform write(rows, migrationId) — see composite targets below.
// engine.js only ever calls target.write(...); it never knows whether that resolves to one
// bulkInsert or several. Junction/log/audit/finance tables are deliberately excluded — nothing
// external ever migrates into audit_log, role_permissions, finance_*, etc.
const { get: dbGet } = require('../db');
const adapter = require('./adapters/SqliteDestinationAdapter');

function simpleTarget({ key, label, table, dependsOn = [], fields }) {
  return {
    key,
    label,
    dependsOn,
    fields,
    tables: [table],
    write: (rows, migrationId) => adapter.bulkInsert(table, rows, migrationId),
    // The Validate step's "destination must be empty" guardrail (v1 assumes an empty target,
    // no source-PK collision handling) — checked against every backing table, so a composite
    // target (Phase 6: students -> users + student_profiles) can report non-empty if *either*
    // side already has rows.
    isEmpty: async () => {
      const row = await dbGet(`SELECT COUNT(*) AS c FROM ${table}`);
      return Number(row.c) === 0;
    },
  };
}

const TARGETS = [
  simpleTarget({
    key: 'colleges',
    label: 'Colleges',
    table: 'colleges',
    // id: mapped from the source table's primary key so imported rows keep their source-system
    // id (v1 "preserve source PKs, assume empty target" guardrail — see isEmpty() above, which is
    // what makes writing an explicit id safe without a collision-handling story).
    fields: {
      id: { type: 'int', required: false },
      name: { type: 'string', required: true },
    },
  }),
  simpleTarget({
    key: 'departments',
    label: 'Departments',
    table: 'departments',
    dependsOn: ['colleges'],
    fields: {
      id: { type: 'int', required: false },
      name: { type: 'string', required: true },
      collegeId: { type: 'int', required: false },
    },
  }),
  simpleTarget({
    key: 'programs',
    label: 'Programs',
    table: 'programs',
    dependsOn: ['departments'],
    fields: {
      id: { type: 'int', required: false },
      name: { type: 'string', required: true },
      departmentId: { type: 'int', required: false },
      degreeLevel: { type: 'string', required: false },
      totalCredits: { type: 'int', required: false },
      numberOfSemesters: { type: 'int', required: false },
    },
  }),
  simpleTarget({
    key: 'terms',
    label: 'Terms',
    table: 'terms',
    fields: {
      id: { type: 'int', required: false },
      name: { type: 'string', required: true },
      startDate: { type: 'date', required: false },
      endDate: { type: 'date', required: false },
      isActive: { type: 'bool', required: false },
    },
  }),
  simpleTarget({
    key: 'rooms',
    label: 'Rooms',
    table: 'rooms',
    fields: {
      id: { type: 'int', required: false },
      name: { type: 'string', required: true },
      type: { type: 'string', required: false },
      capacity: { type: 'int', required: false },
      equipment: { type: 'string', required: false },
    },
  }),
  simpleTarget({
    key: 'courses',
    label: 'Courses',
    table: 'courses',
    // teacherId is deliberately not mapped in v1 — it depends on the composite "teachers" target
    // (users + teachers, added alongside "students" once that composite-write pattern lands), and
    // leaving it out avoids importing a dangling FK to a source-system id that doesn't exist here.
    dependsOn: ['departments', 'terms', 'rooms'],
    fields: {
      id: { type: 'int', required: false },
      code: { type: 'string', required: true },
      name: { type: 'string', required: true },
      departmentId: { type: 'int', required: false },
      credits: { type: 'int', required: false },
      roomId: { type: 'int', required: false },
      maxStudents: { type: 'int', required: false },
      termId: { type: 'int', required: false },
    },
  }),
];

const BY_KEY = new Map(TARGETS.map(t => [t.key, t]));

function listTargets() {
  return TARGETS.map(({ key, label, dependsOn, fields }) => ({ key, label, dependsOn, fields }));
}

function getTarget(key) {
  return BY_KEY.get(key);
}

/** Best-effort default column mapping for the Map Columns step: case-insensitive exact name
    matches between the discovered source table's columns and this target's fields, plus the
    source table's primary key (if any) defaulted onto `id` — the one place source-PK
    preservation actually gets wired up, since nothing downstream (bulkInsert) does it for you.
    Returns { destField: sourceColumnName }; the user can still override any entry in the UI. */
function suggestColumnMap(discoveredTable, targetFields) {
  const sourceNames = (discoveredTable.columns || []).map(c => c.name);
  const byLowerName = new Map(sourceNames.map(n => [n.toLowerCase(), n]));
  const map = {};
  for (const field of Object.keys(targetFields)) {
    const match = byLowerName.get(field.toLowerCase());
    if (match) map[field] = match;
  }
  const pk = (discoveredTable.primaryKey || [])[0];
  if (pk && 'id' in targetFields) map.id = pk;
  return map;
}

module.exports = { listTargets, getTarget, suggestColumnMap };
