/**
 * Server-side PDF/Excel rendering for reports — takes the exact same {title, columns, rows,
 * chart} shape reportBuilder.runReport() already returns (and dashboardExport.js produces for
 * the Analytics tab), so this is the ONE place that turns report data into a file. No second
 * query path: callers fetch data via runReport()/computeDashboardData(), then hand the result
 * here.
 *
 * PDF keeps the visual table + a simple hand-drawn bar/line chart (pdfkit's own vector
 * primitives — no headless-browser or canvas dependency needed for a bar/line chart this
 * simple). Excel is real, typed data rows via exceljs — the point of the Excel export is further
 * analysis, so unlike the PDF it is never row-capped or rendered as an image.
 */
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const ACCENT = '#4B7FE8';
const MUTED = '#6b7280';
const HEADER_FILL = '#eef1f7';
const ZEBRA_FILL = '#f8f9fb';

// A printed PDF table beyond a few hundred rows stops being useful as a document — the Excel
// export exists precisely for "I need all the rows." The PDF says so when it truncates.
const MAX_PDF_ROWS = 300;

function drawChart(doc, chart, { x, y, width, height }) {
  const data = chart.data || [];
  if (!data.length) return;
  const maxValue = Math.max(1, ...data.map(d => Number(d.value) || 0));
  const labelSpace = 22;
  const plotHeight = height - labelSpace;

  doc.save();
  doc.moveTo(x, y + plotHeight).lineTo(x + width, y + plotHeight).strokeColor('#d0d5dd').lineWidth(1).stroke();

  if (chart.type === 'line') {
    const stepX = data.length > 1 ? width / (data.length - 1) : 0;
    const points = data.map((d, i) => ({
      px: x + (data.length > 1 ? i * stepX : width / 2),
      py: y + plotHeight - ((Number(d.value) || 0) / maxValue) * plotHeight,
      label: d.label,
    }));
    doc.strokeColor(ACCENT).lineWidth(2);
    points.forEach((p, i) => (i === 0 ? doc.moveTo(p.px, p.py) : doc.lineTo(p.px, p.py)));
    doc.stroke();
    points.forEach(p => doc.circle(p.px, p.py, 2.5).fillColor(ACCENT).fill());
    points.forEach(p => {
      doc.fillColor(MUTED).fontSize(7)
        .text(String(p.label ?? ''), p.px - stepX / 2, y + plotHeight + 4, { width: Math.max(stepX, 30), align: 'center', lineBreak: false, ellipsis: true });
    });
  } else {
    const slot = width / data.length;
    const barWidth = Math.max(3, slot * 0.6);
    data.forEach((d, i) => {
      const value = Number(d.value) || 0;
      const barHeight = plotHeight * (value / maxValue);
      const barX = x + i * slot + (slot - barWidth) / 2;
      const barY = y + plotHeight - barHeight;
      doc.rect(barX, barY, barWidth, Math.max(barHeight, 0.5)).fillColor(ACCENT).fill();
      doc.fillColor(MUTED).fontSize(7)
        .text(String(d.label ?? ''), x + i * slot, y + plotHeight + 4, { width: slot, align: 'center', lineBreak: false, ellipsis: true });
    });
  }
  doc.restore();
}

function drawTable(doc, columns, rows, { x, y, width }) {
  const colWidth = width / Math.max(1, columns.length);
  const rowHeight = 18;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  let cursorY = y;

  function drawHeader() {
    doc.rect(x, cursorY, width, rowHeight).fillColor(HEADER_FILL).fill();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a1a1a');
    columns.forEach((c, i) => {
      doc.text(c.label, x + i * colWidth + 4, cursorY + 5, { width: colWidth - 8, lineBreak: false, ellipsis: true });
    });
    doc.font('Helvetica');
    cursorY += rowHeight;
  }

  drawHeader();
  rows.forEach((row, rIdx) => {
    if (cursorY + rowHeight > bottomLimit) {
      doc.addPage();
      cursorY = doc.page.margins.top;
      drawHeader();
    }
    if (rIdx % 2 === 1) doc.rect(x, cursorY, width, rowHeight).fillColor(ZEBRA_FILL).fill();
    doc.fillColor('#333').fontSize(8);
    columns.forEach((c, i) => {
      const value = row[c.key];
      const text = value === null || value === undefined || value === '' ? '—' : String(value);
      doc.text(text, x + i * colWidth + 4, cursorY + 5, { width: colWidth - 8, lineBreak: false, ellipsis: true });
    });
    cursorY += rowHeight;
  });
}

/** Renders {title, subtitle?, columns, rows, chart?} into a PDF Buffer. */
function renderPdf({ title, subtitle, columns, rows, chart }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text(title || 'Report');
      doc.font('Helvetica');
      if (subtitle) doc.fontSize(9).fillColor(MUTED).text(subtitle);
      doc.fillColor('#000');
      doc.moveDown(0.6);

      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      if (chart && chart.data && chart.data.length) {
        const chartTop = doc.y;
        drawChart(doc, chart, { x: doc.page.margins.left, y: chartTop, width: contentWidth, height: 170 });
        doc.y = chartTop + 170 + 18;
      }

      const truncated = rows.length > MAX_PDF_ROWS;
      const tableRows = truncated ? rows.slice(0, MAX_PDF_ROWS) : rows;
      if (truncated) {
        doc.fontSize(8).fillColor(MUTED)
          .text(`Showing the first ${MAX_PDF_ROWS} of ${rows.length} rows — use the Excel export for the full data.`);
        doc.moveDown(0.4);
        doc.fillColor('#000');
      }

      drawTable(doc, columns, tableRows, { x: doc.page.margins.left, y: doc.y, width: contentWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Renders {title, columns, rows} into a real .xlsx Buffer — typed rows, no row cap, no chart
    image (a real workbook is the point; charts stay the PDF's job). */
async function renderXlsx({ title, columns, rows }) {
  const wb = new ExcelJS.Workbook();
  const sheetName = String(title || 'Report').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Report';
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, Math.min(40, c.label.length + 4)) }));
  rows.forEach((row) => ws.addRow(row));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F7' } };
  if (columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return wb.xlsx.writeBuffer();
}

module.exports = { renderPdf, renderXlsx, MAX_PDF_ROWS };
