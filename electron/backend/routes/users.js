const express = require('express');
const bcrypt = require('bcryptjs');
const { all, get, run, findUserByEmail, logAudit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { isValidPassword, isValidEmail } = require('../validate');
const { createAccountWithTempPassword } = require('../accounts');
const { ASSIGNABLE_ROLES, isDepartmentScoped, isCollegeScoped } = require('../permissions');
const { safeCreateNotification } = require('../notificationTypes');

const router = express.Router();
const SAFE_COLUMNS = 'id, name, email, role, departmentId, collegeId, createdAt, mustChangePassword, idNumber';
// Every role a Super Admin may assign (via role change on an existing account).
const ROLES = ASSIGNABLE_ROLES;
// Roles that can be handed out through account creation (single or bulk). Admin
// accounts are never created here — only seeded, or promoted via PUT /:id.
const CREATABLE_ROLES = ASSIGNABLE_ROLES.filter(r => r !== 'admin');
// Roles that require a department to be chosen: faculty (linked teacher record
// carries it) and any single-department-scoped role (e.g. Department Head).
function roleNeedsDepartment(role) {
  return role === 'faculty' || isDepartmentScoped(role);
}
// Roles that require a college (Dean).
function roleNeedsCollege(role) {
  return isCollegeScoped(role);
}

/** Finds an existing teacher record with no login yet whose name matches (case-insensitive) —
    so creating a faculty account for someone already listed as a bare teacher (e.g. one the
    PDF importer added without a login) links to that record instead of creating a duplicate.
    Mirrors the same name-matching createAccountWithTempPassword's `teacherId` linking already
    supports for the PDF import flow (see timetableImport.js) — this just reaches it from the
    ordinary Users-page "Create account" / bulk-import paths too. */
async function findBareTeacherByName(name) {
  return get('SELECT id FROM teachers WHERE userId IS NULL AND LOWER(name) = LOWER(?)', [name]);
}

router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.role) { clauses.push('role = ?'); params.push(req.query.role); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  res.json(await all(`SELECT ${SAFE_COLUMNS} FROM users ${where} ORDER BY name`, params));
}));

/** Creates one user with a random temporary password (hashed at rest) and, for faculty, a linked teacher record. Never emails anything — the plaintext temp password is returned once, here, for the admin to hand over manually. */
router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const role = req.body.role;
  const departmentId = req.body.departmentId;
  const collegeId = req.body.collegeId;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!CREATABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role for account creation' });
  if (roleNeedsDepartment(role) && !departmentId) return res.status(400).json({ error: 'A department is required for this role' });
  if (roleNeedsCollege(role) && !collegeId) return res.status(400).json({ error: 'A college is required for this role' });
  const existing = await findUserByEmail(email);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const bareTeacher = role === 'faculty' ? await findBareTeacherByName(name) : null;
  const account = await createAccountWithTempPassword({ name, email, role, departmentId, collegeId, teacherId: bareTeacher?.id });
  const user = await get(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ?`, [account.id]);
  await logAudit(req.user, 'create', 'users', account.id, { name, email, role });
  await safeCreateNotification({recipientUserId:account.id,type:'temporary_credentials_issued',title:'Account created',
    message:'Your account was created with temporary credentials. Change your password after signing in.',severity:'critical',entityType:'user',entityId:account.id,
    deduplicationKey:`temporary-credentials:${account.id}`,createdBy:req.user.sub});
  res.status(201).json({ user, tempPassword: account.tempPassword });
}));

/** Bulk account creation from a pre-parsed CSV/Excel row array (parsing happens client-side; this endpoint just validates and inserts). A bad row is skipped and reported — it never fails the whole batch. */
router.post('/bulk-import', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided' });

  const departments = await all('SELECT id, name FROM departments');
  const deptByName = new Map(departments.map(d => [d.name.trim().toLowerCase(), d.id]));

  const created = [];
  const errors = [];
  const seenEmails = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    const name = String(r.name || '').trim();
    const email = String(r.email || '').trim().toLowerCase();
    let role = String(r.role || '').trim().toLowerCase();
    if (role === 'teacher') role = 'faculty'; // CSV alias — "teachers get the faculty role"

    if (!name || !email) { errors.push({ row: rowNum, error: 'Name and email are required' }); continue; }
    if (!isValidEmail(email)) { errors.push({ row: rowNum, error: `Invalid email address "${email}"` }); continue; }
    if (!CREATABLE_ROLES.includes(role)) { errors.push({ row: rowNum, error: 'Role must be "faculty"/"teacher" or "student"' }); continue; }
    if (seenEmails.has(email)) { errors.push({ row: rowNum, error: `Duplicate email in this file: ${email}` }); continue; }
    const existing = await findUserByEmail(email);
    if (existing) { errors.push({ row: rowNum, error: `Account already exists: ${email}` }); continue; }

    let departmentId = null;
    if (role === 'faculty') {
      const deptName = String(r.department || '').trim();
      if (!deptName) { errors.push({ row: rowNum, error: 'Department is required for faculty' }); continue; }
      departmentId = deptByName.get(deptName.toLowerCase());
      if (!departmentId) { errors.push({ row: rowNum, error: `Unknown department "${deptName}"` }); continue; }
    }

    seenEmails.add(email);
    const bareTeacher = role === 'faculty' ? await findBareTeacherByName(name) : null;
    const account = await createAccountWithTempPassword({ name, email, role, departmentId, teacherId: bareTeacher?.id });
    created.push({ row: rowNum, id: account.id, name, email, role, tempPassword: account.tempPassword, idNumber: account.idNumber });
  }
  if (created.length) {
    await logAudit(req.user, 'bulk-import', 'users', null, { count: created.length, emails: created.map(c => c.email) });
  }
  for(const account of created)await safeCreateNotification({recipientUserId:account.id,type:'temporary_credentials_issued',title:'Account created',message:'Your account was created with temporary credentials. Change your password after signing in.',severity:'critical',entityType:'user',entityId:account.id,deduplicationKey:`temporary-credentials:${account.id}`,createdBy:req.user.sub});
  res.status(200).json({ created, errors });
}));

router.get('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const row = await get(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

router.put('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, role } = req.body;
  const departmentId = req.body.departmentId;
  const collegeId = req.body.collegeId;
  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (role !== undefined && Number(req.params.id) === req.user.sub && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own Super Admin role' });
  }
  const existing = await get('SELECT role, departmentId, collegeId FROM users WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const effectiveRole = role !== undefined ? role : existing.role;
  const effectiveDept = departmentId !== undefined ? departmentId : existing.departmentId;
  const effectiveCollege = collegeId !== undefined ? collegeId : existing.collegeId;
  if (isDepartmentScoped(effectiveRole) && !effectiveDept) {
    return res.status(400).json({ error: 'A department is required for this role.' });
  }
  if (isCollegeScoped(effectiveRole) && !effectiveCollege) {
    return res.status(400).json({ error: 'A college is required for this role.' });
  }
  const cols = [];
  const params = [];
  if (name !== undefined) { cols.push('name = ?'); params.push(name); }
  if (role !== undefined) { cols.push('role = ?'); params.push(role); }
  if (departmentId !== undefined) { cols.push('departmentId = ?'); params.push(departmentId || null); }
  if (collegeId !== undefined) { cols.push('collegeId = ?'); params.push(collegeId || null); }
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await run(`UPDATE users SET ${cols.join(', ')} WHERE id = ?`, params);
  const row = await get(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user, 'update', 'users', req.params.id, { name, role, departmentId, collegeId });
  if(role!==undefined&&role!==existing.role)await safeCreateNotification({recipientUserId:Number(req.params.id),type:'role_assignment_changed',title:'Account role changed',message:`Your university account role changed to ${role}.`,severity:'critical',entityType:'user',entityId:Number(req.params.id),deduplicationKey:`role-change:${req.params.id}:${existing.role}:${role}`,createdBy:req.user.sub});
  res.json(row);
}));

router.put('/:id/password', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const user = await get('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const passwordHash = bcrypt.hashSync(password, 8);
  // An admin-set password is a shared secret again, same as at account creation — force a change on next login.
  await run('UPDATE users SET passwordHash = ?, mustChangePassword = 1 WHERE id = ?', [passwordHash, req.params.id]);
  await logAudit(req.user, 'reset-password', 'users', req.params.id, null);
  await safeCreateNotification({recipientUserId:Number(req.params.id),type:'temporary_credentials_issued',title:'Password reset',message:'An administrator reset your password. You must change it after signing in.',severity:'critical',entityType:'user',entityId:Number(req.params.id),deduplicationKey:`password-reset:${req.params.id}:${Date.now()}`,createdBy:req.user.sub});
  res.json({ ok: true });
}));

router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.sub) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const enrolled = await get('SELECT id FROM enrollments WHERE studentId = ? LIMIT 1', [req.params.id]);
  if (enrolled) return res.status(409).json({ error: 'Cannot remove — this user has enrollment history.' });
  const teaching = await get('SELECT id FROM teachers WHERE userId = ? LIMIT 1', [req.params.id]);
  if (teaching) return res.status(409).json({ error: 'Cannot remove — this user is linked to a teacher record.' });
  const target = await get('SELECT name, email FROM users WHERE id = ?', [req.params.id]);
  await run('DELETE FROM users WHERE id = ?', [req.params.id]);
  await logAudit(req.user, 'delete', 'users', req.params.id, target);
  res.status(204).end();
}));

module.exports = router;
