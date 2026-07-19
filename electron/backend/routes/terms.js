const express = require('express');
const { all, get, run, logAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { isPositiveInt } = require('../validate');

const router = express.Router();
const FIELDS = ['name', 'startDate', 'endDate', 'isActive', 'offDays', 'creditLimit', 'examStartDate', 'examEndDate'];
const VALID_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function validateDateRange(body) {
  if (body.startDate && body.endDate && body.endDate < body.startDate) {
    return 'End date cannot be before the start date.';
  }
  if (body.examStartDate && body.examEndDate && body.examEndDate < body.examStartDate) {
    return 'Exam period end date cannot be before the exam period start date.';
  }
  return null;
}

/** "spring 2026" / "SPRING 2026" -> "Spring 2026" — title-cases every word except a bare
    4-digit year, which is left as-is. Keeps semester names consistent without forcing the
    admin to remember exact capitalization when typing one in. */
function normalizeTermName(name) {
  return name.trim().replace(/\s+/g, ' ').split(' ')
    .map(w => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Case-insensitive duplicate-name check against every other term row. */
async function findDuplicateName(name, excludeId) {
  const rows = excludeId
    ? await all('SELECT id, name FROM terms WHERE id != ?', [excludeId])
    : await all('SELECT id, name FROM terms');
  return rows.find(r => r.name.trim().toLowerCase() === name.trim().toLowerCase());
}

/** creditLimit is optional — undefined (field omitted) leaves it untouched, null explicitly
    clears it (no limit), anything else must be a positive whole number. */
function validateCreditLimit(body) {
  if (body.creditLimit === undefined || body.creditLimit === null) return null;
  if (!isPositiveInt(body.creditLimit)) return 'Credit limit must be a positive whole number, or left blank for no limit.';
  return null;
}

/** offDays arrives as a JSON string (e.g. '["Fri"]') — validate it parses to an array of real day abbreviations. */
function validateOffDays(body) {
  if (body.offDays === undefined) return null;
  let parsed;
  try { parsed = JSON.parse(body.offDays); } catch { return 'offDays must be a JSON array of day abbreviations.'; }
  if (!Array.isArray(parsed) || !parsed.every(d => VALID_DAYS.includes(d))) {
    return `offDays must only contain: ${VALID_DAYS.join(', ')}.`;
  }
  return null;
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json(await all('SELECT * FROM terms'));
}));

router.get('/active/current', requireAuth, asyncHandler(async (req, res) => {
  const term = await get('SELECT * FROM terms WHERE isActive = 1 ORDER BY id DESC LIMIT 1');
  res.json(term || null);
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM terms WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const cols = FIELDS.filter(f => req.body[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'No fields provided' });
  if (!req.body.name || !req.body.name.trim()) return res.status(400).json({ error: 'Semester name is required' });
  req.body.name = normalizeTermName(req.body.name);
  const dup = await findDuplicateName(req.body.name);
  if (dup) return res.status(409).json({ error: `A semester named "${dup.name}" already exists.` });
  const dateErr = validateDateRange(req.body);
  if (dateErr) return res.status(400).json({ error: dateErr });
  const offDaysErr = validateOffDays(req.body);
  if (offDaysErr) return res.status(400).json({ error: offDaysErr });
  const creditLimitErr = validateCreditLimit(req.body);
  if (creditLimitErr) return res.status(400).json({ error: creditLimitErr });
  if (req.body.isActive) await run('UPDATE terms SET isActive = 0');
  const result = await run(`INSERT INTO terms (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(c => req.body[c]));
  res.status(201).json(await get('SELECT * FROM terms WHERE id = ?', [result.id]));
}));

router.put('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const cols = FIELDS.filter(f => req.body[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  if (req.body.name !== undefined) {
    if (!req.body.name.trim()) return res.status(400).json({ error: 'Semester name is required' });
    req.body.name = normalizeTermName(req.body.name);
    const dup = await findDuplicateName(req.body.name, req.params.id);
    if (dup) return res.status(409).json({ error: `A semester named "${dup.name}" already exists.` });
  }
  const dateErr = validateDateRange(req.body);
  if (dateErr) return res.status(400).json({ error: dateErr });
  const offDaysErr = validateOffDays(req.body);
  if (offDaysErr) return res.status(400).json({ error: offDaysErr });
  const creditLimitErr = validateCreditLimit(req.body);
  if (creditLimitErr) return res.status(400).json({ error: creditLimitErr });
  if (req.body.isActive) await run('UPDATE terms SET isActive = 0 WHERE id != ?', [req.params.id]);
  await run(`UPDATE terms SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => req.body[c]), req.params.id]);
  const row = await get('SELECT * FROM terms WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

router.post('/:id/rollover', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const targetTermId = req.params.id;
  const { sourceTermId } = req.body;
  if (!sourceTermId) return res.status(400).json({ error: 'sourceTermId is required' });
  if (String(sourceTermId) === String(targetTermId)) return res.status(400).json({ error: 'Source and target term must be different' });

  const targetTerm = await get('SELECT id FROM terms WHERE id = ?', [targetTermId]);
  if (!targetTerm) return res.status(404).json({ error: 'Target term not found' });
  const sourceTerm = await get('SELECT id FROM terms WHERE id = ?', [sourceTermId]);
  if (!sourceTerm) return res.status(404).json({ error: 'Source term not found' });

  const sourceCourses = await all('SELECT * FROM courses WHERE termId = ?', [sourceTermId]);
  if (!sourceCourses.length) return res.status(200).json({ created: [], errors: [] });

  const created = [];
  const errors = [];
  for (const c of sourceCourses) {
    const existing = await get('SELECT id FROM courses WHERE code = ? AND termId = ?', [c.code, targetTermId]);
    if (existing) { errors.push({ code: c.code, error: `Course code ${c.code} already exists in the target term` }); continue; }
    const cols = ['code', 'name', 'departmentId', 'credits', 'teacherId', 'roomId', 'maxStudents', 'termId'];
    const vals = [c.code, c.name, c.departmentId, c.credits, c.teacherId, c.roomId, c.maxStudents, targetTermId];
    const result = await run(`INSERT INTO courses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
    created.push({ id: result.id, code: c.code });
  }
  if (created.length) {
    await logAudit(req.user, 'rollover', 'terms', targetTermId, { sourceTermId, count: created.length, codes: created.map(c => c.code) });
  }
  res.status(200).json({ created, errors });
}));

router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const inUse = await get('SELECT id FROM courses WHERE termId = ? LIMIT 1', [req.params.id]);
  if (inUse) return res.status(409).json({ error: 'Cannot remove — this term still has courses scheduled in it.' });
  await run('DELETE FROM terms WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
