const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { all, run, logAudit, DB_PATH } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const asyncHandler = require('../middleware/asyncHandler');
const { getGradingScale, validateScale, recomputeFinalGradesForCourse } = require('../gradingScale');

const router = express.Router();

// Lives next to the database file itself (same directory as the JWT secret / DB backups),
// so it moves with the database on backup/restore and stays per-install in embedded mode,
// or shared for everyone in a shared-server deployment — never bundled with app source.
const BRANDING_DIR = DB_PATH === ':memory:' ? null : path.join(path.dirname(DB_PATH), 'branding');
const logoFile = () => path.join(BRANDING_DIR, 'logo');

const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

async function getAllSettings() {
  const rows = await all('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function setSetting(key, value) {
  await run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

function brandingPayload(s) {
  return {
    orgName: s.orgName || null,
    brandColor: s.brandColor || null,
    hasLogo: !!s.logoContentType,
    logoVersion: s.logoVersion || '0',
    // Domain used to build auto-generated student email addresses on admissions approval (see
    // routes/applications.js) — this app isn't tied to any one institution, so it's admin-set
    // here rather than hardcoded, defaulting to an obviously-fake placeholder until changed.
    emailDomain: s.emailDomain || 'student.university.edu',
  };
}

/** Public — no requireAuth. The login screen and sidebar both need to show branding before
    anyone has signed in, and there is nothing sensitive in an org's display name/color/logo. */
router.get('/branding', asyncHandler(async (req, res) => {
  res.json(brandingPayload(await getAllSettings()));
}));

router.get('/branding/logo', asyncHandler(async (req, res) => {
  const s = await getAllSettings();
  if (!s.logoContentType || !BRANDING_DIR || !fs.existsSync(logoFile())) return res.status(404).end();
  res.setHeader('Content-Type', s.logoContentType);
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(logoFile()).pipe(res);
}));

/** orgName being unset is what "first run" means for this feature (see AppDataContext's
    boot()) — so this endpoint is also how first-run setup completes, not just how settings
    get edited later. Both call sites (the setup screen and the Settings page) use it. */
router.put('/branding', requireAuth, requirePermission('branding', 'write'), asyncHandler(async (req, res) => {
  const { orgName, brandColor, emailDomain } = req.body;
  if (orgName !== undefined) {
    const trimmed = String(orgName).trim();
    if (!trimmed) return res.status(400).json({ error: 'Organization name is required' });
    await setSetting('orgName', trimmed);
  }
  if (brandColor !== undefined) {
    if (brandColor !== null && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
      return res.status(400).json({ error: 'Brand color must be a hex code like #4B7FE8' });
    }
    await setSetting('brandColor', brandColor || '');
  }
  if (emailDomain !== undefined) {
    const trimmed = String(emailDomain).trim().toLowerCase();
    if (!trimmed || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed)) {
      return res.status(400).json({ error: 'Enter a valid domain, e.g. student.university.edu' });
    }
    await setSetting('emailDomain', trimmed);
  }
  await logAudit(req.user, 'update', 'settings', null, { orgName, brandColor, emailDomain });
  res.json(brandingPayload(await getAllSettings()));
}));

router.post('/branding/logo', requireAuth, requirePermission('branding', 'write'), upload.single('logo'), asyncHandler(async (req, res) => {
  if (!BRANDING_DIR) return res.status(400).json({ error: 'Cannot store a logo for an in-memory database' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!ALLOWED_LOGO_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'Logo must be a PNG, JPEG, SVG, or WebP image' });
  }
  fs.mkdirSync(BRANDING_DIR, { recursive: true });
  fs.writeFileSync(logoFile(), req.file.buffer);
  await setSetting('logoContentType', req.file.mimetype);
  await setSetting('logoVersion', String(Date.now()));
  await logAudit(req.user, 'upload-logo', 'settings', null, null);
  res.json(brandingPayload(await getAllSettings()));
}));

router.delete('/branding/logo', requireAuth, requirePermission('branding', 'write'), asyncHandler(async (req, res) => {
  if (BRANDING_DIR) { try { fs.unlinkSync(logoFile()); } catch { /* already gone */ } }
  await run("DELETE FROM settings WHERE key = 'logoContentType'");
  await logAudit(req.user, 'remove-logo', 'settings', null, null);
  res.json(brandingPayload(await getAllSettings()));
}));

// --- Grading scale — a single system-wide set of percent -> letter-grade bands, admin only ---

router.get('/grading-scale', requireAuth, requirePermission('gradingScale', 'read'), asyncHandler(async (req, res) => {
  res.json({ bands: await getGradingScale() });
}));

router.put('/grading-scale', requireAuth, requirePermission('gradingScale', 'write'), asyncHandler(async (req, res) => {
  const { bands } = req.body;
  const error = validateScale(bands);
  if (error) return res.status(400).json({ error });
  const normalized = bands.map(b => ({ label: b.label.trim(), min: b.min, point: b.point }));

  await setSetting('gradingScale', JSON.stringify(normalized));
  await logAudit(req.user, 'update', 'settings', null, { gradingScale: normalized });

  // A threshold change should be reflected immediately everywhere, not just after the next
  // mark edit — recompute every course that currently has enrolled students.
  const courses = await all(`SELECT DISTINCT courseId FROM enrollments WHERE status = 'enrolled'`);
  for (const c of courses) await recomputeFinalGradesForCourse(c.courseId);

  res.json({ bands: await getGradingScale() });
}));

// --- Graduation requirement — a single system-wide target credit total, admin only. Used by
// the Student Profile page to show "completed vs required" credits; null/unset until an admin
// configures it (no default guessed here). ---

router.get('/graduation-requirement', requireAuth, requirePermission('gradingScale', 'read'), asyncHandler(async (req, res) => {
  const s = await getAllSettings();
  const n = Number(s.requiredCreditsForGraduation);
  res.json({ requiredCredits: s.requiredCreditsForGraduation && !Number.isNaN(n) ? n : null });
}));

router.put('/graduation-requirement', requireAuth, requirePermission('gradingScale', 'write'), asyncHandler(async (req, res) => {
  const { requiredCredits } = req.body;
  if (requiredCredits === null) {
    await setSetting('requiredCreditsForGraduation', '');
  } else {
    const n = Number(requiredCredits);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'Required credits must be a positive number' });
    await setSetting('requiredCreditsForGraduation', String(n));
  }
  await logAudit(req.user, 'update', 'settings', null, { requiredCreditsForGraduation: requiredCredits });
  const s = await getAllSettings();
  const n2 = Number(s.requiredCreditsForGraduation);
  res.json({ requiredCredits: s.requiredCreditsForGraduation && !Number.isNaN(n2) ? n2 : null });
}));

module.exports = router;
