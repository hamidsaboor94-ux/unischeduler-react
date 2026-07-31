const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { listEntities, ENTITIES } = require('../reportEntities');
const { runReport, httpError } = require('../reportBuilder');
const { renderPdf, renderXlsx } = require('../reportExport');
const { computeDashboardData } = require('../dashboardAnalytics');
const { buildDashboardExport } = require('../dashboardExport');

const router = express.Router();

function sanitizeFilename(name) {
  return String(name || 'report').replace(/[^a-z0-9-_ ]/gi, '_').trim().slice(0, 80) || 'report';
}

function sendPdf(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}.pdf"`);
  res.send(buffer);
}

function sendXlsx(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}.xlsx"`);
  res.send(buffer);
}

function respondError(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  throw err;
}

function parseConfig(raw) {
  if (!raw) throw httpError(400, 'Missing report config.');
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw httpError(400, 'Malformed report config.');
  }
}

/** Analytics for the Reports page — see dashboardAnalytics.js for the query itself (shared with
    the PDF/Excel dashboard export below, so there's exactly one query path for this data). */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json(await computeDashboardData(req.query.termId));
}));

/* ---------------------------- Custom report builder ---------------------------- *
 * Deterministic report builder (see reportEntities.js / reportBuilder.js): the client picks an
 * entity, columns, filters and an optional grouping from a server-side whitelist — never raw SQL.
 * Mounted behind requireModuleAccess('reports') like the rest of this router (app.js), so GET
 * routes need reports:read (registrar/records_officer/viewer/admin) and mutating routes need
 * reports:write (records_officer/admin) — running a report is a GET (read-only, no side effects)
 * even though its config can be large, so it doesn't require write access just to view data.
 */

/** Entity/field metadata that drives the builder's picker UI. */
router.get('/entities', requireAuth, asyncHandler(async (req, res) => {
  res.json(listEntities());
}));

/** Ad-hoc run: GET with the config JSON-encoded in a query param (kept a GET, not a POST, so
    read-only roles can run reports without needing reports:write). */
router.get('/run', requireAuth, asyncHandler(async (req, res) => {
  try {
    const config = parseConfig(req.query.config);
    const result = await runReport(req.query.entity, config);
    res.json(result);
  } catch (err) { respondError(res, err); }
}));

/* --------------------------------- Export (PDF/Excel) --------------------------------- *
 * Every export route is a GET, same as /run and /definitions/:id/run — exporting is a read
 * operation on data you could already see on screen, so it needs reports:read, never
 * reports:write. Each route fetches its data via runReport()/buildDashboardExport() (the same
 * functions the JSON endpoints above use) and hands the result straight to reportExport.js —
 * no query is ever written twice for "view" vs "export".
 */
router.get('/export/pdf', requireAuth, asyncHandler(async (req, res) => {
  try {
    const config = parseConfig(req.query.config);
    const result = await runReport(req.query.entity, config);
    const buffer = await renderPdf({ title: ENTITIES[req.query.entity]?.label, columns: result.columns, rows: result.rows, chart: result.chart });
    sendPdf(res, ENTITIES[req.query.entity]?.label, buffer);
  } catch (err) { respondError(res, err); }
}));

router.get('/export/xlsx', requireAuth, asyncHandler(async (req, res) => {
  try {
    const config = parseConfig(req.query.config);
    const result = await runReport(req.query.entity, config);
    const buffer = await renderXlsx({ title: ENTITIES[req.query.entity]?.label, columns: result.columns, rows: result.rows });
    sendXlsx(res, ENTITIES[req.query.entity]?.label, buffer);
  } catch (err) { respondError(res, err); }
}));

router.get('/export/dashboard/pdf', requireAuth, asyncHandler(async (req, res) => {
  try {
    const shaped = await buildDashboardExport(req.query.chart, req.query.termId);
    const buffer = await renderPdf(shaped);
    sendPdf(res, shaped.title, buffer);
  } catch (err) { respondError(res, err); }
}));

router.get('/export/dashboard/xlsx', requireAuth, asyncHandler(async (req, res) => {
  try {
    const shaped = await buildDashboardExport(req.query.chart, req.query.termId);
    const buffer = await renderXlsx(shaped);
    sendXlsx(res, shaped.title, buffer);
  } catch (err) { respondError(res, err); }
}));

router.get('/definitions', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT rd.id, rd.name, rd.entity, rd.config, rd.chartType, rd.createdAt, rd.updatedAt,
            rd.createdBy, u.name as createdByName
     FROM report_definitions rd
     LEFT JOIN users u ON u.id = rd.createdBy
     ORDER BY rd.updatedAt DESC`
  );
  res.json(rows.map((r) => ({ ...r, config: JSON.parse(r.config) })));
}));

router.get('/definitions/:id', requireAuth, asyncHandler(async (req, res) => {
  const row = await get(
    `SELECT rd.id, rd.name, rd.entity, rd.config, rd.chartType, rd.createdAt, rd.updatedAt,
            rd.createdBy, u.name as createdByName
     FROM report_definitions rd
     LEFT JOIN users u ON u.id = rd.createdBy
     WHERE rd.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, config: JSON.parse(row.config) });
}));

router.get('/definitions/:id/run', requireAuth, asyncHandler(async (req, res) => {
  const def = await get('SELECT entity, config FROM report_definitions WHERE id = ?', [req.params.id]);
  if (!def) return res.status(404).json({ error: 'Not found' });
  try {
    const result = await runReport(def.entity, JSON.parse(def.config));
    res.json(result);
  } catch (err) { respondError(res, err); }
}));

router.get('/definitions/:id/export/pdf', requireAuth, asyncHandler(async (req, res) => {
  const def = await get('SELECT name, entity, config FROM report_definitions WHERE id = ?', [req.params.id]);
  if (!def) return res.status(404).json({ error: 'Not found' });
  try {
    const result = await runReport(def.entity, JSON.parse(def.config));
    const buffer = await renderPdf({ title: def.name, columns: result.columns, rows: result.rows, chart: result.chart });
    sendPdf(res, def.name, buffer);
  } catch (err) { respondError(res, err); }
}));

router.get('/definitions/:id/export/xlsx', requireAuth, asyncHandler(async (req, res) => {
  const def = await get('SELECT name, entity, config FROM report_definitions WHERE id = ?', [req.params.id]);
  if (!def) return res.status(404).json({ error: 'Not found' });
  try {
    const result = await runReport(def.entity, JSON.parse(def.config));
    const buffer = await renderXlsx({ title: def.name, columns: result.columns, rows: result.rows });
    sendXlsx(res, def.name, buffer);
  } catch (err) { respondError(res, err); }
}));

router.post('/definitions', requireAuth, asyncHandler(async (req, res) => {
  const { name, entity, config, chartType } = req.body || {};
  if (!name || !String(name).trim()) throw httpError(400, 'A report name is required.');
  const parsedConfig = parseConfig(config);
  try {
    // Validate the config against the whitelist before saving — a bad save should fail loudly,
    // not silently produce an empty report every time it's later run.
    await runReport(entity, parsedConfig);
  } catch (err) { return respondError(res, err); }

  const { id } = await run(
    'INSERT INTO report_definitions (name, entity, config, chartType, createdBy) VALUES (?, ?, ?, ?, ?)',
    [String(name).trim(), entity, JSON.stringify(parsedConfig), chartType || null, req.user.sub]
  );
  await logAudit(req.user, 'report-definition-create', 'report_definitions', id, null, null, { name, entity });
  const row = await get('SELECT id, name, entity, config, chartType, createdAt, updatedAt, createdBy FROM report_definitions WHERE id = ?', [id]);
  res.status(201).json({ ...row, config: JSON.parse(row.config) });
}));

router.put('/definitions/:id', requireAuth, asyncHandler(async (req, res) => {
  const existing = await get('SELECT * FROM report_definitions WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, entity, config, chartType } = req.body || {};
  const nextEntity = entity || existing.entity;
  const nextConfig = config !== undefined ? parseConfig(config) : JSON.parse(existing.config);
  try {
    await runReport(nextEntity, nextConfig);
  } catch (err) { return respondError(res, err); }

  await run(
    'UPDATE report_definitions SET name = ?, entity = ?, config = ?, chartType = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
    [name ? String(name).trim() : existing.name, nextEntity, JSON.stringify(nextConfig), chartType !== undefined ? chartType : existing.chartType, req.params.id]
  );
  await logAudit(req.user, 'report-definition-update', 'report_definitions', Number(req.params.id), null, { name: existing.name }, { name: name || existing.name });
  const row = await get('SELECT id, name, entity, config, chartType, createdAt, updatedAt, createdBy FROM report_definitions WHERE id = ?', [req.params.id]);
  res.json({ ...row, config: JSON.parse(row.config) });
}));

router.delete('/definitions/:id', requireAuth, asyncHandler(async (req, res) => {
  const existing = await get('SELECT id, name FROM report_definitions WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await run('DELETE FROM report_definitions WHERE id = ?', [req.params.id]);
  await logAudit(req.user, 'report-definition-delete', 'report_definitions', existing.id, null, { name: existing.name }, null);
  res.json({ ok: true });
}));

module.exports = router;
