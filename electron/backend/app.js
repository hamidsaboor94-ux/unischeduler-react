const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { findUserByEmail, get, run, logAudit } = require('./db');
const { requireAuth, JWT_SECRET } = require('./middleware/auth');
const { requireModuleAccess } = require('./middleware/permission');
const { departmentScopeForUser } = require('./scope');
const asyncHandler = require('./middleware/asyncHandler');
const { isValidPassword, isValidEmail } = require('./validate');

const app = express();

// Unset CORS_ORIGIN reflects the request's own origin (today's permissive dev
// default). Set it to a comma-separated allowlist to lock this down for a
// real deployment, e.g. CORS_ORIGIN=https://scheduler.example.edu
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : true;
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

// Auth rate limiting guards /login and /set-password against password-guessing. Defaults are
// strict in production but much more relaxed everywhere else, since development/testing means
// logging into the same few accounts over and over — override either independently of NODE_ENV
// with AUTH_RATE_LIMIT_MAX / AUTH_RATE_LIMIT_WINDOW_MINUTES (e.g. to dial production down further,
// or to tighten a staging environment). The limiter's counters live in memory only, so restarting
// the API process clears any current lockout instantly.
const isProduction = process.env.NODE_ENV === 'production';
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX) || (isProduction ? 20 : 300);
const AUTH_RATE_LIMIT_WINDOW_MINUTES = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MINUTES) || (isProduction ? 15 : 5);

const authLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please try again later.' }
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

// There is no public self-registration. The only account created outside the
// app is the default admin (see seed.js) — every other account is created by
// an admin via POST /api/users or /api/users/bulk-import, which hand back a
// one-time temporary password instead of sending email.
app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await findUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  // A correct login clears this IP's failed-attempt count entirely, rather than leaving it
  // partway toward the limit — someone who mistypes a password a few times before getting it
  // right shouldn't still be creeping toward a lockout caused by their own successful logins.
  authLimiter.resetKey(ipKeyGenerator(req.ip));
  const mustChangePassword = !!user.mustChangePassword;
  const departmentIds = await departmentScopeForUser(user);
  const token = jwt.sign({ sub: user.id, role: user.role, departmentId: user.departmentId ?? null, collegeId: user.collegeId ?? null, departmentIds, email: user.email, mustChangePassword }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, departmentId: user.departmentId ?? null, collegeId: user.collegeId ?? null, name: user.name, mustChangePassword, idNumber: user.idNumber, language: user.language || 'en' } });
}));

app.get('/api/auth/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await get('SELECT id, name, email, role, departmentId, collegeId, createdAt, mustChangePassword, idNumber, language FROM users WHERE id = ?', [req.user.sub]);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
}));

app.put('/api/auth/set-password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!isValidPassword(newPassword)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const passwordHash = bcrypt.hashSync(newPassword, 8);
  await run('UPDATE users SET passwordHash = ?, mustChangePassword = 0 WHERE id = ?', [passwordHash, req.user.sub]);
  const user = await get('SELECT id, name, email, role, departmentId, collegeId, idNumber, language FROM users WHERE id = ?', [req.user.sub]);
  const departmentIds = await departmentScopeForUser(user);
  const token = jwt.sign({ sub: user.id, role: user.role, departmentId: user.departmentId ?? null, collegeId: user.collegeId ?? null, departmentIds, email: user.email, mustChangePassword: false }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { ...user, mustChangePassword: false } });
}));

/** Self-service profile edit (name/email) for whoever the token belongs to — distinct from
    PUT /api/users/:id, which is admin-only and can't touch email. Any role can call this on
    their own account. */
app.put('/api/auth/profile', requireAuth, asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const existing = await findUserByEmail(email);
  if (existing && existing.id !== req.user.sub) return res.status(409).json({ error: 'An account with that email already exists' });
  await run('UPDATE users SET name = ?, email = ? WHERE id = ?', [name, email, req.user.sub]);
  const user = await get('SELECT id, name, email, role, createdAt, mustChangePassword, idNumber, language FROM users WHERE id = ?', [req.user.sub]);
  await logAudit(req.user, 'update-profile', 'users', req.user.sub, { name, email });
  res.json(user);
}));

// Supported UI languages — English plus the two RTL languages this deployment targets.
const SUPPORTED_LANGUAGES = ['en', 'ps', 'prs'];

/** Self-service language preference — per-user (not a global setting), so each account
    remembers its own choice independently of who else is logged in elsewhere. No audit entry:
    this is a personal display preference, not an administrative action. */
app.put('/api/auth/language', requireAuth, asyncHandler(async (req, res) => {
  const { language } = req.body;
  if (!SUPPORTED_LANGUAGES.includes(language)) return res.status(400).json({ error: 'Unsupported language' });
  await run('UPDATE users SET language = ? WHERE id = ?', [language, req.user.sub]);
  res.json({ ok: true, language });
}));

/** Self-service password change — unlike PUT /api/auth/set-password (forced first-login reset,
    no current-password check) this requires proving the current password first, and unlike
    PUT /api/users/:id/password (admin resetting someone else's) it never forces mustChangePassword
    back on, since the account holder chose this password themselves. Rate-limited like login/
    set-password, since it's another place an attacker could brute-force a password guess. */
app.put('/api/auth/change-password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.sub]);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (!isValidPassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (newPassword === currentPassword) return res.status(400).json({ error: 'New password must be different from your current password' });
  const passwordHash = bcrypt.hashSync(newPassword, 8);
  await run('UPDATE users SET passwordHash = ?, mustChangePassword = 0 WHERE id = ?', [passwordHash, req.user.sub]);
  await logAudit(req.user, 'change-password', 'users', req.user.sub, null);
  res.json({ ok: true });
}));

// Mount-level permission guards: requireModuleAccess enforces the central
// policy (permissions.js) — read access to reach a module at all, write access
// for mutating methods (faculty/student excepted, since their routes do
// per-object ownership checks). Routers with public or multi-module endpoints
// (settings, applications, student-profile, notifications, and the course-content
// routers) enforce permissions internally instead, so they're mounted bare.
app.use('/api/users', requireAuth, requireModuleAccess('users'), require('./routes/users'));
app.use('/api/audit-log', requireAuth, requireModuleAccess('audit'), require('./routes/auditLog'));
app.use('/api/colleges', requireAuth, requireModuleAccess('departments', { openRead: true }), require('./routes/colleges'));
app.use('/api/departments', requireAuth, requireModuleAccess('departments', { openRead: true }), require('./routes/departments'));
app.use('/api/terms', requireAuth, requireModuleAccess('terms'), require('./routes/terms'));
app.use('/api/teachers', requireAuth, requireModuleAccess('teachers', { openRead: true }), require('./routes/teachers'));
app.use('/api/rooms', requireAuth, requireModuleAccess('rooms', { openRead: true }), require('./routes/rooms'));
app.use('/api/courses', requireAuth, requireModuleAccess('courses', { allowOwnerWrite: true }), require('./routes/courses'));
app.use('/api/slots', requireAuth, requireModuleAccess('timetable'), require('./routes/slots'));
app.use('/api/slot-exceptions', requireAuth, requireModuleAccess('timetable'), require('./routes/slotExceptions'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/attendance', requireAuth, requireModuleAccess('attendance'), require('./routes/attendance'));
app.use('/api/exams', requireAuth, requireModuleAccess('exams', { allowOwnerWrite: true }), require('./routes/exams'));
app.use('/api/conflicts', requireAuth, requireModuleAccess('conflicts'), require('./routes/conflicts'));
app.use('/api/reports', requireAuth, requireModuleAccess('reports'), require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/enrollments', requireAuth, requireModuleAccess('enrollment', { allowOwnerWrite: true }), require('./routes/enrollments'));
app.use('/api/grades', requireAuth, requireModuleAccess('grades'), require('./routes/grades'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/course-activity', require('./routes/courseActivity'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/student-profile', require('./routes/studentProfile'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/timetable-import', requireAuth, requireModuleAccess('timetable'), require('./routes/timetableImport'));
app.use('/api/backup', requireAuth, requireModuleAccess('backup'), require('./routes/backup'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

module.exports = app;
