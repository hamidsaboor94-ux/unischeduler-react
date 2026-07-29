/**
 * Central authorization: requirePermission('Module.Action') — the single middleware new and
 * migrated routes should use instead of a raw requireRole(...) or an inline
 * `req.user.role === '...'` check. Looks up role_permissions/permissions (seeded from the legacy
 * POLICY in permissions.js — see db.js's seedAuthzTables()), and additionally validates
 * department/college org scope server-side when the caller supplies `scopeOf`.
 *
 * Coexists with (does not replace) the legacy can()/requireModuleAccess() — routes migrate to
 * this one at a time; anything not yet migrated keeps working exactly as before.
 */
const { get, all } = require('./db');
const { isScopedRequest, departmentInScope } = require('./scope');

/** A user's roles for permission purposes: their one primary users.role plus any secondary roles
    from user_roles (additive — a user with none behaves exactly as a single-role user always
    has). `primaryRole` comes from the JWT (req.user.role), never re-queried per request. */
async function getUserRoles(userId, primaryRole) {
  const secondary = await all('SELECT role FROM user_roles WHERE userId = ?', [userId]);
  const roles = secondary.map(r => r.role);
  return roles.includes(primaryRole) ? roles : [primaryRole, ...roles];
}

async function roleHasPermission(role, module, action) {
  const row = await get(
    `SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permissionId
     WHERE rp.role = ? AND p.module = ? AND p.action = ?`,
    [role, module, action]
  );
  return !!row;
}

/** True if ANY of `roles` grants `module`.`action`. Admin is always allowed, mirroring the
    legacy levelFor()'s "admin always WRITE" rule rather than depending on a seeded row for it. */
async function hasPermission(roles, module, action) {
  if (roles.includes('admin')) return true;
  for (const role of roles) {
    if (await roleHasPermission(role, module, action)) return true;
  }
  return false;
}

/**
 * requirePermission('Module.Action', opts?)
 *
 * opts.scopeOf(req) — optional async function resolving { departmentId } (or null/undefined)
 * for the entity this request targets. When the caller holds a department/college-scoped role
 * (Dept Head/Dean — see scope.js), the resolved departmentId must be inside their scope or the
 * request 403s, even though they passed the module/action check. Skipped entirely for
 * unrestricted roles (isScopedRequest(req) is false for them), so this never adds a check where
 * none existed before for e.g. Registrar/Admin.
 */
function requirePermission(moduleAction, opts = {}) {
  const [module, action] = moduleAction.split('.');
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Missing token' });
    const roles = await getUserRoles(req.user.sub, req.user.role);
    const allowed = await hasPermission(roles, module, action);
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to do this.', code: 'NO_PERMISSION', module, action });
    }
    if (opts.scopeOf && isScopedRequest(req)) {
      const scope = await opts.scopeOf(req);
      if (scope && scope.departmentId != null && !departmentInScope(req, scope.departmentId)) {
        return res.status(403).json({ error: 'This is outside your department scope.', code: 'OUT_OF_SCOPE' });
      }
    }
    next();
  };
}

module.exports = { requirePermission, hasPermission, getUserRoles };
