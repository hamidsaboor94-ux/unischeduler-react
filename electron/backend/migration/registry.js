// The factory registry that keeps migration/engine.js agnostic of every concrete SourceConnector.
// Each factory takes the connection config and returns a plain object
// { connect(), discover(), readRows(table, {batchSize}), close() } — engine.js only ever calls
// those four methods, never imports a connector module directly or branches on sourceType.
const CONNECTOR_FACTORIES = {
  sqlite: (cfg) => require('./connectors/SqliteFileConnector')(cfg),
  mysql: (cfg) => require('./connectors/GenericSqlConnector')({ ...cfg, driver: 'mysql' }),
  postgres: (cfg) => require('./connectors/GenericSqlConnector')({ ...cfg, driver: 'postgres' }),
  mssql: (cfg) => require('./connectors/GenericSqlConnector')({ ...cfg, driver: 'mssql' }),
  csv: (cfg) => require('./connectors/CsvConnector')(cfg),
  excel: (cfg) => require('./connectors/ExcelConnector')(cfg),
};

function getConnector(sourceType, cfg) {
  const factory = CONNECTOR_FACTORIES[sourceType];
  if (!factory) throw new Error(`Unsupported source type: ${sourceType}`);
  return factory(cfg);
}

function listSourceTypes() {
  return Object.keys(CONNECTOR_FACTORIES);
}

module.exports = { getConnector, listSourceTypes };
