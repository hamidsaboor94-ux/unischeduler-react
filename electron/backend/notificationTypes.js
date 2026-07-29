/** The complete set of event types allowed to become a persisted, per-user notification.
 * Persisted notifications are for meaningful domain events a recipient needs to know about
 * after the fact (they may not be logged in when the event happens) — never for transient UI
 * feedback like "Saved." or validation errors (those are toasts, see ToastContext.jsx on the
 * frontend) and never for HTTP error responses (those are handled at the call site).
 *
 * Adding a new kind of notification means adding it here first, then calling
 * createNotification() with that type — nothing may insert into the notifications table any
 * other way, so this list is always the true, complete picture of what can appear in it. */
const NOTIFICATION_TYPES = new Set([
  'class_cancelled',       // a scheduled class session was cancelled — alerts the instructor
  'assignment_posted',     // a new assignment was posted in a course the recipient is enrolled in
  'announcement_posted',   // a new announcement was posted in a course the recipient is enrolled in
  'application_submitted', // a new admissions application is awaiting review — alerts admins
]);

const { run } = require('./db');

/** The single writer for the notifications table. `type` must be on the NOTIFICATION_TYPES
 * allowlist — this is what keeps the feed signal (meaningful events) rather than a log of
 * everything. `userId` is the one and only recipient; every notification belongs to exactly
 * one account. */
async function createNotification(userId, message, type, { courseId, entityType, entityId } = {}) {
  if (!NOTIFICATION_TYPES.has(type)) {
    throw new Error(`"${type}" is not on the notification type allowlist (see notificationTypes.js)`);
  }
  await run(
    'INSERT INTO notifications (userId, message, type, courseId, entityType, entityId) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, message, type, courseId ?? null, entityType ?? null, entityId ?? null]
  );
}

module.exports = { NOTIFICATION_TYPES, createNotification };
