/** Periodic sweep that makes scheduling/expiry reliable without depending on any browser being
    open (per the "Send Now / Schedule for Later" requirement) — this Node process is already
    long-running (see index.js), so a simple interval is enough; no external job queue needed. */
const { all, run, logAudit } = require('./db');
const { publishNotice } = require('./noticePublish');

// No real user is behind a scheduled publish/expiry — this is what logAudit's user param
// records for those rows instead of a blank one, so the audit trail is honest about the actor.
const SYSTEM_ACTOR = { sub: null, email: 'system-scheduler', role: 'system' };

/** Publishes every 'scheduled' notice whose time has come. Each is published independently —
    one bad notice (e.g. a target department deleted after scheduling) logs and is skipped
    rather than blocking every other due notice behind it. */
async function publishDueNotices() {
  const due = await all(`SELECT id FROM notices WHERE status = 'scheduled' AND scheduledFor <= CURRENT_TIMESTAMP`);
  for (const notice of due) {
    try {
      await publishNotice(notice.id, SYSTEM_ACTOR);
    } catch (err) {
      console.error(`Failed to publish scheduled notice #${notice.id}:`, err.message);
    }
  }
}

/** Flips a published notice to 'expired' once its expiresAt has passed — a status change only,
    never a delete, so it stays in history (still visible in the Archived/Expired tabs). */
async function expireDueNotices() {
  const due = await all(`SELECT id FROM notices WHERE status = 'published' AND expiresAt IS NOT NULL AND expiresAt <= CURRENT_TIMESTAMP`);
  for (const notice of due) {
    await run(`UPDATE notices SET status = 'expired', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [notice.id]);
    await logAudit(SYSTEM_ACTOR, 'expire-notice', 'notices', notice.id, null);
  }
}

async function runNoticeScheduler() {
  try {
    await publishDueNotices();
    await expireDueNotices();
  } catch (err) {
    console.error('Notice scheduler sweep failed:', err.message);
  }
}

module.exports = { runNoticeScheduler };
