const ExcelJS = require('exceljs');
const { sniffColumns } = require('./columnTypeSniffer');

const SAMPLE_SIZE = 200;

function headersOf(worksheet) {
  return worksheet.getRow(1).values.slice(1).map(h => String(h ?? '').trim());
}

/** Read-only SourceConnector over one uploaded Excel workbook — same exceljs/columnTypeSniffer
    approach as CsvConnector.js, except discover() reports one table per worksheet instead of one
    table for the whole file. `table` in readRows() is a worksheet name. */
function createExcelConnector(cfg) {
  let workbook = null;

  async function connect() {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(cfg.filePath);
  }

  async function discover() {
    return workbook.worksheets.map(ws => {
      const headers = headersOf(ws);
      const sampleRows = [];
      const maxSampleRow = Math.min(ws.rowCount, SAMPLE_SIZE + 1);
      for (let i = 2; i <= maxSampleRow; i++) sampleRows.push(ws.getRow(i).values.slice(1));
      return {
        name: ws.name,
        rowCount: Math.max(0, ws.rowCount - 1), // rowCount includes the header row
        primaryKey: [],
        columns: sniffColumns(headers, sampleRows),
        foreignKeys: [],
      };
    });
  }

  async function* readRows(table, { batchSize = 500 } = {}) {
    const worksheet = workbook.worksheets.find(ws => ws.name === table);
    if (!worksheet) throw new Error(`Unknown worksheet "${table}"`);
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
    workbook = null;
  }

  return { connect, discover, readRows, close };
}

module.exports = createExcelConnector;
