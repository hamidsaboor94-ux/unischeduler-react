/**
 * University-wide targeted announcement system. Mounted bare in app.js (like /api/notifications)
 * rather than behind a mount-level requireModuleAccess, because the /me/* endpoints must be
 * reachable by every authenticated role regardless of the 'announcements' module policy — a
 * student or faculty member always has the right to read/acknowledge notices addressed to them,
 * the same way /finance/me is self-scoped rather than module-gated. Every management endpoint
 * (create/edit/publish/schedule/archive/recipients/analytics) instead carries its own
 * requirePermission('announcements.Action') check.
 */
const express = require('express');
const multer = require('multer');
const { get, all, run, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, hasPermission, getUserRoles } = require('../authz');
const asyncHandler = require('../middleware/asyncHandler');
const { ROLES } = require('../permissions');
const { isScopedRequest, departmentScopeClause } = require('../scope');
const { createNotification } = require('../notificationTypes');
const { NOTICE_TYPES, NOTICE_PRIORITIES, STAFF_ROLES } = require('../noticeConstants');
const { TargetingError, validateGroup, validateGroups, resolveRecipients, enforceTargetingScope } = require('../noticeTargeting');
const { getGroupsForNotice, publishNotice } = require('../noticePublish');
const {
  ATTACHMENTS_DIR, ALLOWED_ATTACHMENT_TYPES,
  attachmentFilePath, writeAttachment, deleteAttachmentFile, attachmentFileExists,
} = require('../noticeAttachmentStorage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/** True if the caller may manage this specific notice: unrestricted roles (registrar/admin) may
    manage any; a department/college-scoped role (Dept Head/Dean) only their own. Mirrors the
    "createdBy === self" narrowing used throughout — a scoped role's write access is already
    confined to their own department by enforceTargetingScope() at creation time, so their own
    notices are, by construction, never outside their scope. */
function canManageNotice(req, notice) {
  return !isScopedRequest(req) || notice.createdBy === req.user.sub;
}

function isValidNoticeBody(body) {
  if (!String(body.title || '').trim()) return 'Title is required.';
  if (!String(body.message || '').trim()) return 'Message is required.';
  if (body.type !== undefined && !NOTICE_TYPES.includes(body.type)) return 'Invalid announcement type.';
  if (body.priority !== undefined && !NOTICE_PRIORITIES.includes(body.priority)) return 'Invalid priority.';
  return null;
}

/* ------------------------------- Targeting metadata / preview ------------------------------- */

// Real, live UMS data backing the recipient filter builder — never a hardcoded list. Scoped
// callers (Dept Head/Dean) only see the departments/programs/courses inside their own scope, so
// the UI can't even offer to target outside it.
router.get('/meta/targeting-options', requireAuth, requirePermission('announcements.Create'), asyncHandler(async (req, res) => {
  const deptScope = departmentScopeClause(req, 'id');
  const departments = deptScope
    ? await all(`SELECT * FROM departments WHERE ${deptScope.clause} ORDER BY name`, deptScope.params)
    : await all('SELECT * FROM departments ORDER BY name');
  const colleges = isScopedRequest(req) ? [] : await all('SELECT * FROM colleges ORDER BY name');
  const progScope = departmentScopeClause(req, 'departmentId');
  const programs = progScope
    ? await all(`SELECT * FROM programs WHERE ${progScope.clause} ORDER BY name`, progScope.params)
    : await all('SELECT * FROM programs ORDER BY name');
  const courseScope = departmentScopeClause(req, 'departmentId');
  const courses = courseScope
    ? await all(`SELECT id, code, name, departmentId FROM courses WHERE ${courseScope.clause} ORDER BY code`, courseScope.params)
    : await all('SELECT id, code, name, departmentId FROM courses ORDER BY code');

  const distinct = async (table, column, where) => {
    const rows = await all(`SELECT DISTINCT ${column} as v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != '' ${where || ''} ORDER BY ${column}`);
    return rows.map(r => r.v);
  };
  const semesterRows = await all(`SELECT DISTINCT programSemester as v FROM student_profiles WHERE programSemester IS NOT NULL ORDER BY programSemester`);

  res.json({
    colleges, departments, programs, courses,
    semesters: semesterRows.map(r => r.v),
    sections: await distinct('student_profiles', 'section'),
    studentStatuses: await distinct('student_profiles', 'enrollmentStatus'),
    facultyDesignations: await distinct('teacher_profiles', 'designation'),
    facultyEmploymentTypes: await distinct('teacher_profiles', 'employmentType'),
    facultyStatuses: await distinct('teacher_profiles', 'status'),
    staffRoles: STAFF_ROLES,
    allRoles: Object.keys(ROLES),
  });
}));

// Specific-user picker — never exposes users outside the caller's own targeting scope.
router.get('/meta/users-search', requireAuth, requirePermission('announcements.Create'), asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;
  const clauses = [`(u.name LIKE ? OR u.email LIKE ? OR u.idNumber LIKE ?)`];
  const params = [like, like, like];
  if (isScopedRequest(req)) {
    const deptScope = departmentScopeClause(req, 'COALESCE(sp.departmentId, t.departmentId, u.departmentId)');
    clauses.push(deptScope ? deptScope.clause : '1 = 0');
    if (deptScope) params.push(...deptScope.params);
  }
  const rows = await all(
    `SELECT u.id, u.name, u.email, u.role, u.idNumber FROM users u
     LEFT JOIN student_profiles sp ON sp.studentId = u.id
     LEFT JOIN teachers t ON t.userId = u.id
     WHERE ${clauses.join(' AND ')}
     ORDER BY u.name LIMIT 20`,
    params
  );
  res.json(rows);
}));

router.post('/preview-recipients', requireAuth, requirePermission('announcements.Create'), asyncHandler(async (req, res) => {
  try {
    const groups = validateGroups(req.body.targetGroups);
    await enforceTargetingScope(req, groups);
    const { perGroup, recipientIds } = await resolveRecipients(groups);
    res.json({ perGroup, total: recipientIds.length });
  } catch (err) {
    if (err instanceof TargetingError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

/* ---------------------------------------- Management ---------------------------------------- */

router.get('/', requireAuth, requirePermission('announcements.View'), asyncHandler(async (req, res) => {
  const clauses = [];
  const params = [];
  if (isScopedRequest(req)) { clauses.push('n.createdBy = ?'); params.push(req.user.sub); }
  if (req.query.status) {
    const statuses = String(req.query.status).split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length) { clauses.push(`n.status IN (${statuses.map(() => '?').join(', ')})`); params.push(...statuses); }
  }
  if (req.query.type) { clauses.push('n.type = ?'); params.push(req.query.type); }
  if (req.query.search) {
    clauses.push('(n.title LIKE ? OR n.message LIKE ?)');
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await all(
    `SELECT n.*, u.name as createdByName,
       (SELECT COUNT(*) FROM notice_recipients nr WHERE nr.noticeId = n.id) as recipientCount,
       (SELECT COUNT(*) FROM notice_target_groups g WHERE g.noticeId = n.id) as groupCount
     FROM notices n LEFT JOIN users u ON u.id = n.createdBy
     ${where} ORDER BY n.pinned DESC, n.createdAt DESC`,
    params
  );
  res.json(rows);
}));

router.post('/', requireAuth, requirePermission('announcements.Create'), asyncHandler(async (req, res) => {
  const invalid = isValidNoticeBody(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  const {
    title, message, type = 'general', priority = 'normal', pinned, requiresAck,
    actionLabel, actionSection, expiresAt, action = 'draft', scheduledFor, targetGroups,
  } = req.body;

  let groups = [];
  try {
    groups = action === 'draft' && !Array.isArray(targetGroups) ? [] : (Array.isArray(targetGroups) ? targetGroups.map(validateGroup) : validateGroups(targetGroups));
  } catch (err) {
    if (err instanceof TargetingError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (action !== 'draft') {
    if (!groups.length) return res.status(400).json({ error: 'At least one recipient group is required.' });
    try {
      await enforceTargetingScope(req, groups);
    } catch (err) {
      if (err instanceof TargetingError) return res.status(403).json({ error: err.message });
      throw err;
    }
  }

  if (action === 'schedule') {
    if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor)) || new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'A valid future schedule date/time is required.' });
    }
  }

  const status = action === 'schedule' ? 'scheduled' : 'draft';
  const result = await run(
    `INSERT INTO notices (title, message, type, priority, status, pinned, requiresAck, actionLabel, actionSection, scheduledFor, expiresAt, createdBy, createdByRole)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title.trim(), message.trim(), type, priority, status, pinned ? 1 : 0, requiresAck ? 1 : 0,
      actionLabel || null, actionSection || null, action === 'schedule' ? scheduledFor : null,
      expiresAt || null, req.user.sub, req.user.role,
    ]
  );
  for (const g of groups) {
    await run('INSERT INTO notice_target_groups (noticeId, audience, filters) VALUES (?, ?, ?)', [result.id, g.audience, JSON.stringify(g.filters)]);
  }
  await logAudit(req.user, 'create-notice', 'notices', result.id, { title: title.trim(), type, priority, action });

  let recipientCount;
  if (action === 'publish') {
    ({ recipientCount } = await publishNotice(result.id, req.user));
  }
  res.status(201).json({ ...(await get('SELECT * FROM notices WHERE id = ?', [result.id])), recipientCount });
}));

router.get('/:id', requireAuth, requirePermission('announcements.View'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT n.*, u.name as createdByName FROM notices n LEFT JOIN users u ON u.id = n.createdBy WHERE n.id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  const groups = await all('SELECT id, audience, filters FROM notice_target_groups WHERE noticeId = ?', [notice.id]);
  const attachments = await all('SELECT id, fileName, mimeType, fileSize, createdAt FROM notice_attachments WHERE noticeId = ?', [notice.id]);
  const roles = await getUserRoles(req.user.sub, req.user.role);
  let stats = null;
  if (await hasPermission(roles, 'announcements', 'ViewAnalytics')) {
    const row = await get(
      `SELECT COUNT(*) as total, SUM(CASE WHEN readAt IS NOT NULL THEN 1 ELSE 0 END) as readCount,
              SUM(CASE WHEN acknowledgedAt IS NOT NULL THEN 1 ELSE 0 END) as acknowledgedCount
       FROM notice_recipients WHERE noticeId = ?`,
      [notice.id]
    );
    stats = { total: row.total || 0, read: row.readCount || 0, acknowledged: row.acknowledgedCount || 0 };
  }
  res.json({ ...notice, targetGroups: groups.map(g => ({ id: g.id, audience: g.audience, filters: JSON.parse(g.filters) })), attachments, stats });
}));

router.put('/:id', requireAuth, requirePermission('announcements.Update'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  if (['archived', 'cancelled'].includes(notice.status)) return res.status(400).json({ error: 'This announcement can no longer be edited.' });

  const invalid = isValidNoticeBody(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  const {
    title, message, type = notice.type, priority = notice.priority, pinned, requiresAck,
    actionLabel, actionSection, expiresAt, targetGroups, notifyOnUpdate,
  } = req.body;

  const oldValue = { title: notice.title, message: notice.message, type: notice.type, priority: notice.priority };
  await run(
    `UPDATE notices SET title=?, message=?, type=?, priority=?, pinned=?, requiresAck=?, actionLabel=?, actionSection=?, expiresAt=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?`,
    [title.trim(), message.trim(), type, priority, pinned ? 1 : 0, requiresAck ? 1 : 0, actionLabel || null, actionSection || null, expiresAt || null, notice.id]
  );

  // Retargeting only makes sense before publication — a published notice's recipient snapshot
  // is frozen by design (see "recipient snapshot vs dynamic targeting").
  if (targetGroups !== undefined && (notice.status === 'draft' || notice.status === 'scheduled')) {
    let groups = [];
    try {
      groups = Array.isArray(targetGroups) && targetGroups.length ? validateGroups(targetGroups) : [];
      if (groups.length) await enforceTargetingScope(req, groups);
    } catch (err) {
      if (err instanceof TargetingError) return res.status(400).json({ error: err.message });
      throw err;
    }
    await run('DELETE FROM notice_target_groups WHERE noticeId = ?', [notice.id]);
    for (const g of groups) {
      await run('INSERT INTO notice_target_groups (noticeId, audience, filters) VALUES (?, ?, ?)', [notice.id, g.audience, JSON.stringify(g.filters)]);
    }
  }

  await logAudit(req.user, 'update-notice', 'notices', notice.id, null, oldValue, { title: title.trim(), type, priority });

  // Explicit, separate action (never implicit) — edits a published notice without resending to
  // its already-frozen recipient list unless the composer opts into re-notifying them.
  if (notice.status === 'published' && notifyOnUpdate) {
    const recipients = await all('SELECT userId FROM notice_recipients WHERE noticeId = ?', [notice.id]);
    for (const r of recipients) {
      await createNotification(r.userId, `Updated: ${title.trim()}`, 'notice_published', { entityType: 'notice', entityId: notice.id });
    }
    await logAudit(req.user, 'notify-notice-update', 'notices', notice.id, { recipientCount: recipients.length });
  }

  res.json(await get('SELECT * FROM notices WHERE id = ?', [notice.id]));
}));

router.post('/:id/duplicate', requireAuth, requirePermission('announcements.Create'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  const groups = await getGroupsForNotice(notice.id);
  // Always starts as a fresh, unpinned draft — never auto-publishes and never inherits pin status.
  const result = await run(
    `INSERT INTO notices (title, message, type, priority, status, pinned, requiresAck, actionLabel, actionSection, createdBy, createdByRole)
     VALUES (?, ?, ?, ?, 'draft', 0, ?, ?, ?, ?, ?)`,
    [`Copy of ${notice.title}`, notice.message, notice.type, notice.priority, notice.requiresAck, notice.actionLabel, notice.actionSection, req.user.sub, req.user.role]
  );
  for (const g of groups) {
    await run('INSERT INTO notice_target_groups (noticeId, audience, filters) VALUES (?, ?, ?)', [result.id, g.audience, JSON.stringify(g.filters)]);
  }
  await logAudit(req.user, 'duplicate-notice', 'notices', result.id, { sourceId: notice.id });
  res.status(201).json(await get('SELECT * FROM notices WHERE id = ?', [result.id]));
}));

router.post('/:id/publish', requireAuth, requirePermission('announcements.Publish'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  if (!['draft', 'scheduled'].includes(notice.status)) return res.status(400).json({ error: 'Only a draft or scheduled announcement can be published.' });
  const groups = await getGroupsForNotice(notice.id);
  if (!groups.length) return res.status(400).json({ error: 'Select at least one recipient group before publishing.' });
  try {
    await enforceTargetingScope(req, groups);
  } catch (err) {
    if (err instanceof TargetingError) return res.status(403).json({ error: err.message });
    throw err;
  }
  const { recipientCount } = await publishNotice(notice.id, req.user);
  res.json({ ...(await get('SELECT * FROM notices WHERE id = ?', [notice.id])), recipientCount });
}));

router.post('/:id/schedule', requireAuth, requirePermission('announcements.Schedule'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  if (!['draft', 'scheduled'].includes(notice.status)) return res.status(400).json({ error: 'Only a draft or already-scheduled announcement can be (re)scheduled.' });
  const { scheduledFor } = req.body;
  if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor)) || new Date(scheduledFor) <= new Date()) {
    return res.status(400).json({ error: 'A valid future date/time is required.' });
  }
  const groups = await getGroupsForNotice(notice.id);
  if (!groups.length) return res.status(400).json({ error: 'Select at least one recipient group before scheduling.' });
  try {
    await enforceTargetingScope(req, groups);
  } catch (err) {
    if (err instanceof TargetingError) return res.status(403).json({ error: err.message });
    throw err;
  }
  await run(`UPDATE notices SET status='scheduled', scheduledFor=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?`, [scheduledFor, notice.id]);
  await logAudit(req.user, 'schedule-notice', 'notices', notice.id, { scheduledFor });
  res.json(await get('SELECT * FROM notices WHERE id = ?', [notice.id]));
}));

router.post('/:id/cancel-schedule', requireAuth, requirePermission('announcements.Schedule'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  if (notice.status !== 'scheduled') return res.status(400).json({ error: 'Only a scheduled announcement can be cancelled.' });
  await run(`UPDATE notices SET status='cancelled', updatedAt=CURRENT_TIMESTAMP WHERE id=?`, [notice.id]);
  await logAudit(req.user, 'cancel-notice-schedule', 'notices', notice.id, null);
  res.json(await get('SELECT * FROM notices WHERE id = ?', [notice.id]));
}));

router.post('/:id/archive', requireAuth, requirePermission('announcements.Archive'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  if (!['published', 'expired', 'draft', 'cancelled'].includes(notice.status)) return res.status(400).json({ error: 'Cannot archive this announcement.' });
  await run(`UPDATE notices SET status='archived', updatedAt=CURRENT_TIMESTAMP WHERE id=?`, [notice.id]);
  await logAudit(req.user, 'archive-notice', 'notices', notice.id, null);
  res.json(await get('SELECT * FROM notices WHERE id = ?', [notice.id]));
}));

router.delete('/:id', requireAuth, requirePermission('announcements.Delete'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  if (notice.status !== 'draft') return res.status(400).json({ error: 'Only a draft can be deleted — archive it instead.' });
  const attachments = await all('SELECT id FROM notice_attachments WHERE noticeId = ?', [notice.id]);
  await run('DELETE FROM notices WHERE id = ?', [notice.id]); // cascades target_groups/recipients/attachments rows
  attachments.forEach(a => deleteAttachmentFile(a.id));
  await logAudit(req.user, 'delete-notice', 'notices', notice.id, { title: notice.title });
  res.status(204).end();
}));

/* --------------------------------- Recipients / analytics ----------------------------------- */

router.get('/:id/recipients', requireAuth, requirePermission('announcements.ManageRecipients'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT id, createdBy FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  const rows = await all(
    `SELECT nr.userId, u.name, u.email, u.role, nr.status, nr.deliveredAt, nr.readAt, nr.acknowledgedAt
     FROM notice_recipients nr JOIN users u ON u.id = nr.userId WHERE nr.noticeId = ? ORDER BY u.name`,
    [notice.id]
  );
  res.json(rows);
}));

router.get('/:id/analytics', requireAuth, requirePermission('announcements.ViewAnalytics'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT id, createdBy, requiresAck FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  const row = await get(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN readAt IS NOT NULL THEN 1 ELSE 0 END) as readCount,
            SUM(CASE WHEN acknowledgedAt IS NOT NULL THEN 1 ELSE 0 END) as acknowledgedCount,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
     FROM notice_recipients WHERE noticeId = ?`,
    [notice.id]
  );
  const total = row.total || 0;
  res.json({
    total,
    delivered: total - (row.failed || 0),
    read: row.readCount || 0,
    unread: total - (row.readCount || 0),
    acknowledged: row.acknowledgedCount || 0,
    failed: row.failed || 0,
    readRate: total ? (row.readCount || 0) / total : 0,
    acknowledgmentRate: notice.requiresAck && total ? (row.acknowledgedCount || 0) / total : null,
  });
}));

/* ------------------------------------- Attachments ------------------------------------------- */

router.post('/:id/attachments', requireAuth, requirePermission('announcements.Update'), upload.single('file'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT id, createdBy FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  if (!req.file) return res.status(400).json({ error: 'A file is required.' });
  if (!ALLOWED_ATTACHMENT_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'That file type is not supported.' });
  if (!ATTACHMENTS_DIR) return res.status(400).json({ error: 'Cannot store a file for an in-memory database' });

  const result = await run(
    'INSERT INTO notice_attachments (noticeId, fileName, mimeType, fileSize, uploadedBy) VALUES (?, ?, ?, ?, ?)',
    [notice.id, req.file.originalname, req.file.mimetype, req.file.size, req.user.sub]
  );
  writeAttachment(result.id, req.file.buffer);
  await logAudit(req.user, 'upload-notice-attachment', 'notice_attachments', result.id, { noticeId: notice.id, fileName: req.file.originalname });
  res.status(201).json(await get('SELECT * FROM notice_attachments WHERE id = ?', [result.id]));
}));

router.delete('/:id/attachments/:attId', requireAuth, requirePermission('announcements.Update'), asyncHandler(async (req, res) => {
  const notice = await get('SELECT id, createdBy FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!canManageNotice(req, notice)) return res.status(403).json({ error: 'Forbidden' });
  const attachment = await get('SELECT * FROM notice_attachments WHERE id = ? AND noticeId = ?', [req.params.attId, notice.id]);
  if (!attachment) return res.status(404).json({ error: 'Not found' });
  await run('DELETE FROM notice_attachments WHERE id = ?', [attachment.id]);
  deleteAttachmentFile(attachment.id);
  await logAudit(req.user, 'delete-notice-attachment', 'notice_attachments', attachment.id, { noticeId: notice.id, fileName: attachment.fileName });
  res.status(204).end();
}));

router.get('/:id/attachments/:attId/file', requireAuth, asyncHandler(async (req, res) => {
  const attachment = await get('SELECT * FROM notice_attachments WHERE id = ? AND noticeId = ?', [req.params.attId, req.params.id]);
  if (!attachment) return res.status(404).json({ error: 'Not found' });
  const roles = await getUserRoles(req.user.sub, req.user.role);
  const canManage = await hasPermission(roles, 'announcements', 'View');
  const isRecipient = await get('SELECT 1 FROM notice_recipients WHERE noticeId = ? AND userId = ?', [req.params.id, req.user.sub]);
  if (!canManage && !isRecipient) return res.status(403).json({ error: 'You do not have access to this attachment.' });
  if (!attachmentFileExists(attachment.id)) return res.status(404).json({ error: 'File not found' });
  res.download(attachmentFilePath(attachment.id), attachment.fileName);
}));

/* ------------------------------- Recipient-facing ("my notices") ----------------------------- */

router.get('/me/list', requireAuth, asyncHandler(async (req, res) => {
  const statuses = req.query.includeExpired === '1' ? `('published', 'expired')` : `('published')`;
  const rows = await all(
    `SELECT n.id, n.title, n.message, n.type, n.priority, n.pinned, n.requiresAck, n.actionLabel, n.actionSection,
            n.publishedAt, n.expiresAt, n.status, u.name as createdByName, nr.readAt, nr.acknowledgedAt,
            (SELECT COUNT(*) FROM notice_attachments na WHERE na.noticeId = n.id) as attachmentCount
     FROM notice_recipients nr JOIN notices n ON n.id = nr.noticeId LEFT JOIN users u ON u.id = n.createdBy
     WHERE nr.userId = ? AND n.status IN ${statuses}
     ORDER BY n.pinned DESC, n.publishedAt DESC LIMIT 200`,
    [req.user.sub]
  );
  res.json(rows);
}));

router.get('/me/unread-count', requireAuth, asyncHandler(async (req, res) => {
  const row = await get(
    `SELECT COUNT(*) as n FROM notice_recipients nr JOIN notices n ON n.id = nr.noticeId
     WHERE nr.userId = ? AND nr.readAt IS NULL AND n.status = 'published'`,
    [req.user.sub]
  );
  res.json({ count: row.n || 0 });
}));

router.get('/me/:id', requireAuth, asyncHandler(async (req, res) => {
  const recipient = await get('SELECT * FROM notice_recipients WHERE noticeId = ? AND userId = ?', [req.params.id, req.user.sub]);
  if (!recipient) return res.status(404).json({ error: 'Not found' });
  const notice = await get('SELECT n.*, u.name as createdByName FROM notices n LEFT JOIN users u ON u.id = n.createdBy WHERE n.id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!recipient.readAt) {
    await run('UPDATE notice_recipients SET readAt = CURRENT_TIMESTAMP WHERE id = ?', [recipient.id]);
    recipient.readAt = new Date().toISOString();
  }
  const attachments = await all('SELECT id, fileName, mimeType, fileSize FROM notice_attachments WHERE noticeId = ?', [notice.id]);
  res.json({ ...notice, attachments, readAt: recipient.readAt, acknowledgedAt: recipient.acknowledgedAt });
}));

router.put('/me/:id/read', requireAuth, asyncHandler(async (req, res) => {
  await run(`UPDATE notice_recipients SET readAt = CURRENT_TIMESTAMP WHERE noticeId = ? AND userId = ? AND readAt IS NULL`, [req.params.id, req.user.sub]);
  res.json({ ok: true });
}));

router.put('/me/:id/acknowledge', requireAuth, asyncHandler(async (req, res) => {
  const notice = await get('SELECT requiresAck FROM notices WHERE id = ?', [req.params.id]);
  if (!notice) return res.status(404).json({ error: 'Not found' });
  if (!notice.requiresAck) return res.status(400).json({ error: 'This announcement does not require acknowledgment.' });
  const exists = await get('SELECT 1 FROM notice_recipients WHERE noticeId = ? AND userId = ?', [req.params.id, req.user.sub]);
  if (!exists) return res.status(404).json({ error: 'Not found' });
  await run(
    `UPDATE notice_recipients SET acknowledgedAt = CURRENT_TIMESTAMP, readAt = COALESCE(readAt, CURRENT_TIMESTAMP)
     WHERE noticeId = ? AND userId = ? AND acknowledgedAt IS NULL`,
    [req.params.id, req.user.sub]
  );
  res.json({ ok: true });
}));

router.get('/me/:id/attachments/:attId/file', requireAuth, asyncHandler(async (req, res) => {
  const isRecipient = await get('SELECT 1 FROM notice_recipients WHERE noticeId = ? AND userId = ?', [req.params.id, req.user.sub]);
  if (!isRecipient) return res.status(403).json({ error: 'Forbidden' });
  const attachment = await get('SELECT * FROM notice_attachments WHERE id = ? AND noticeId = ?', [req.params.attId, req.params.id]);
  if (!attachment || !attachmentFileExists(attachment.id)) return res.status(404).json({ error: 'Not found' });
  res.download(attachmentFilePath(attachment.id), attachment.fileName);
}));

module.exports = router;
