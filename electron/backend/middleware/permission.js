const { can } = require('../permissions');

/**
 * Route guard: require that the current user's role can `action`
 * ('read' | 'write') the given `module`. Use for individual endpoints that
 * need a specific level regardless of HTTP method.
 */
function requirePermission(module, action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Missing token' });
    if (!can(req.user.role, module, action)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

/**
 * Mount-level guard: require read access to `module`, and require write access
 * for mutating methods (POST/PUT/PATCH/DELETE).
 *
 * `opts.allowOwnerWrite` (used only for courses/exams/enrollment) lets the
 * ownership roles (faculty/student) through mutating methods on the strength of
 * read access alone, because those routers do per-object ownership/self checks
 * (see ownership.js) that this coarse guard can't express — and any CREATE
 * endpoint in them still asserts write permission explicitly, since a
 * not-yet-created row has no owner to check. Without the flag, a mutating method
 * requires real module write access for every role, so faculty can't, say,
 * create a term or edit the timetable just because they can read it.
 */
function requireModuleAccess(module, opts = {}) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Missing token' });
    const role = req.user.role;
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    // Reference-data tables (departments/teachers/rooms) are lookup data every
    // authenticated user may read for display (course→department, →teacher,
    // →room, etc.); only their writes are policy-gated. Department-scoped roles
    // are still confined to their own rows by the router's own scoping.
    if (!mutating && opts.openRead) return next();
    const ownershipRole = role === 'faculty' || role === 'student';
    const action = mutating && !(opts.allowOwnerWrite && ownershipRole) ? 'write' : 'read';
    if (!can(role, module, action)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requirePermission, requireModuleAccess };
