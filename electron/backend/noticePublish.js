/** Shared publish step for notices — used both by the immediate "Send Now" route and by
    noticeScheduler.js's periodic sweep of due scheduled announcements, so the two paths can
    never drift (one resolution/delivery routine, one place recipient snapshots get written). */
const { get, all, run, transaction, logAudit } = require('./db');
const { createNotification } = require('./notificationTypes');
const { resolveRecipients } = require('./noticeTargeting');

async function getGroupsForNotice(noticeId) {
  const rows = await all('SELECT audience, filters FROM notice_target_groups WHERE noticeId = ?', [noticeId]);
  return rows.map(r => ({ audience: r.audience, filters: JSON.parse(r.filters) }));
}

/** Resolves a notice's target groups into final recipients, writes the notice_recipients
    snapshot ("recipient snapshot vs dynamic targeting" — frozen at publish time), fans out a
    bell notification to each, and flips the notice to 'published'. The snapshot + status flip
    happen in one transaction so a crash partway through can never leave a notice half-delivered;
    the notifications loop runs after commit (a notification failure must not roll back delivery
    that already succeeded). */
async function publishNotice(noticeId, actorUser) {
  const notice = await get('SELECT * FROM notices WHERE id = ?', [noticeId]);
  if (!notice) throw new Error('Notice not found');
  const groups = await getGroupsForNotice(noticeId);
  const { recipientIds } = await resolveRecipients(groups);

  await transaction(async () => {
    for (const userId of recipientIds) {
      await run(
        `INSERT OR IGNORE INTO notice_recipients (noticeId, userId, status, deliveredAt) VALUES (?, ?, 'delivered', CURRENT_TIMESTAMP)`,
        [noticeId, userId]
      );
    }
    await run(
      `UPDATE notices SET status = 'published', publishedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [noticeId]
    );
  });

  const preview = notice.message.length > 140 ? notice.message.slice(0, 137) + '...' : notice.message;
  for (const userId of recipientIds) {
    await createNotification(userId, `${notice.title}: ${preview}`, 'notice_published', { entityType: 'notice', entityId: noticeId });
  }

  await logAudit(actorUser, 'publish-notice', 'notices', noticeId, { recipientCount: recipientIds.length, groupCount: groups.length });
  return { recipientCount: recipientIds.length };
}

module.exports = { getGroupsForNotice, publishNotice };
