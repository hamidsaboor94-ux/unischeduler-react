import { ROLES } from './permissions.js';

/**
 * Resolves a role's human display label, honoring white-label configuration.
 * Precedence:
 *   1) per-institution override set in Branding settings (branding.roleNames[role]),
 *   2) the localized name (common:roles.<role>),
 *   3) the built-in English default (permissions ROLES[role].name).
 * This is why role names are never hardcoded to one institution's structure —
 * any deployment can rename "Registrar" to "Scheduling Office", etc.
 */
export function roleLabel(role, t, branding) {
  const override = branding && branding.roleNames && branding.roleNames[role];
  if (override && String(override).trim()) return String(override).trim();
  const key = `common:roles.${role}`;
  const translated = t ? t(key) : null;
  if (translated && translated !== key) return translated;
  return (ROLES[role] && ROLES[role].name) || role;
}
