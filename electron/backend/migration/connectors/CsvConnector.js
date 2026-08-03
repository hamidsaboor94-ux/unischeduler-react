const path = require('path');
const ExcelJS = require('exceljs');
const { sniffColumns } = require('./columnTypeSniffer');

const SAMPLE_SIZE = 200;

function headersOf(worksheet) {
  return worksheet.getRow(1).values.slice(1).map(h => String(h ?? '').trim());
}

/** Read-only SourceConnector over one uploaded CSV file — reuses `exceljs` (already a dependency,
    previously only used for report/PDF-timetable-import export) rather than adding a new parsing
    library, since no CSV-import code already exists in this codebase to reuse instead. A CSV has
    no declared schema, so discover() reports exactly one table (the file itself) with types
    sniffed from a sample of its rows (columnTypeSniffer.js), and no primary key / foreign keys —
    unlike a SQL source, there's nothing here for the Map Columns step to default `id` onto. */
function createCsvConnector(cfg) {
  let worksheet = null;
  let tableName = null;

  async function connect() {
    const workbook = new ExcelJS.Workbook();
    worksheet = await workbook.csv.readFile(cfg.filePath);
    // Prefer the originally-uploaded filename (e.g. "students.csv" -> "students") over the opaque
    // server-side storage path, so the Discover/Map Columns steps show a name the user recognizes.
    tableName = path.basename(cfg.originalName || cfg.filePath).replace(/\.[^.]+$/, '') || 'data';
  }

  async function discover() {
    const headers = headersOf(worksheet);
    const sampleRows = [];
    const maxSampleRow = Math.min(worksheet.rowCount, SAMPLE_SIZE + 1);
    for (let i = 2; i <= maxSampleRow; i++) sampleRows.push(worksheet.getRow(i).values.slice(1));
    return [{
      name: tableName,
      rowCount: Math.max(0, worksheet.rowCount - 1), // rowCount includes the header row
      primaryKey: [],
      columns: sniffColumns(headers, sampleRows),
      foreignKeys: [],
    }];
  }

  async function* readRows(table, { batchSize = 500 } = {}) {
    if (table !== tableName) throw new Error(`Unknown table "${table}" — this CSV only has "${tableName}"`);
    const headers = headersOf(worksheet);
    let batch = [];
    for (let i = 2; i <= worksheet.rowCount; i++) {
      const values = worksheet.getRow(i).values.slice(1);
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx]; });
      batch.push(row);
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
  }

  async function close() {
    worksheet = null;
  }

  return { connect, discover, readRows, close };
}

module.exports = createCsvConnector;
