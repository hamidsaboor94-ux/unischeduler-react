const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error(
    'JWT_SECRET must be set when NODE_ENV=production — refusing to start with the ' +
    'default development secret, which would let anyone forge admin tokens.'
  );
}
if (!process.env.JWT_SECRET) {
  console.warn(
    '\n⚠️  JWT_SECRET is not set — using an insecure default development secret.\n' +
    '   Set the JWT_SECRET environment variable before deploying this anywhere real.\n'
  );
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Routes reachable with a "must change password" token — everything else is
// blocked until the user sets a real password, enforced here (not just
// hidden in the UI) so a forced reset can't be bypassed by calling the API
// directly.
const PASSWORD_RESET_EXEMPT_PATHS = ['/api/auth/set-password', '/api/auth/me'];

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    const path = req.originalUrl.split('?')[0];
    if (req.user.mustChangePassword && !PASSWORD_RESET_EXEMPT_PATHS.includes(path)) {
      return res.status(403).json({ error: 'You must set a new password before continuing.', code: 'MUST_CHANGE_PASSWORD' });
    }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, JWT_SECRET };
