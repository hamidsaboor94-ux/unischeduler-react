const { run, get } = require('./db');

const NOTIFICATION_TYPES = new Set([
  'class_cancelled','class_rescheduled','assignment_posted','assignment_deadline_changed','assignment_due_soon',
  'submission_received','submission_graded','course_announcement_posted','announcement_posted','material_published',
  'application_submitted','application_status_changed','student_account_created','admission_documents_requested',
  'enrollment_succeeded','enrollment_rejected','enrollment_waitlisted','waitlist_promoted','course_dropped','registration_deadline',
  'attendance_posted','attendance_corrected','attendance_warning','attendance_exam_block','attendance_at_risk','attendance_unmarked',
  'exam_scheduled','exam_rescheduled','exam_cancelled','exam_admission_blocked','exam_reminder',
  'grade_published','grade_changed','results_released','grade_incomplete',
  'gpa_finalized','academic_standing_changed','progression_succeeded','progression_blocked','progression_override',
  'graduation_eligible','graduation_blocked','graduation_clearance_started','graduation_clearance_decision','graduation_finalized',
  'invoice_generated','finance_charge_changed','payment_recorded','receipt_generated','installment_due','installment_overdue',
  'account_cleared','finance_hold_changed','refund_processed','waiver_processed',
  'approval_submitted','approval_queue_entered','approval_status_changed','notice_published',
  'password_changed','account_status_changed','role_assignment_changed','temporary_credentials_issued','security_profile_changed',
]);

const SEVERITIES = new Set(['info','success','warning','critical']);
const OPTIONAL_CATEGORIES = new Set(['lms','assignment_reminders','finance_reminders','announcements','academic_updates']);
const MANDATORY_TYPES = new Set([
  'password_changed','account_status_changed','role_assignment_changed','temporary_credentials_issued',
  'grade_published','grade_changed','results_released','academic_standing_changed','progression_succeeded','progression_blocked',
  'graduation_eligible','graduation_blocked','graduation_clearance_decision','graduation_finalized',
  'finance_hold_changed','exam_scheduled','exam_rescheduled','exam_cancelled','exam_admission_blocked',
]);

function humanTitle(type) {
  return String(type).split('_').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
}

function normalize(args, message, type, meta = {}) {
  if (typeof args === 'object' && args !== null) return { ...args };
  return { recipientUserId:args, message, type, courseId:meta.courseId, entityType:meta.entityType,
    entityId:meta.entityId, title:meta.title, severity:meta.severity, actionSection:meta.actionSection,
    actionData:meta.actionData, metadata:meta.metadata, deduplicationKey:meta.deduplicationKey, createdBy:meta.createdBy,
    category:meta.category };
}

async function preferenceAllows(userId, category, type) {
  if (!category || MANDATORY_TYPES.has(type)) return true;
  if (!OPTIONAL_CATEGORIES.has(category)) throw new Error(`Unknown notification preference category "${category}".`);
  const row = await get('SELECT enabled FROM notification_preferences WHERE userId=? AND category=?', [userId,category]);
  return row?.enabled !== 0;
}

async function createNotification(args, legacyMessage, legacyType, legacyMeta) {
  const n = normalize(args, legacyMessage, legacyType, legacyMeta);
  if (!NOTIFICATION_TYPES.has(n.type)) throw new Error(`"${n.type}" is not on the notification type allowlist.`);
  if (!SEVERITIES.has(n.severity || 'info')) throw new Error(`Invalid notification severity "${n.severity}".`);
  const recipient = await get('SELECT id FROM users WHERE id=?', [n.recipientUserId]);
  if (!recipient) throw new Error(`Notification recipient ${n.recipientUserId} does not exist in this institution.`);
  if (!(await preferenceAllows(recipient.id,n.category,n.type))) return { skipped:true, reason:'preference_disabled' };
  const params=[recipient.id,String(n.message||'').trim(),n.type,n.courseId??null,n.entityType??null,n.entityId??null,
    n.title||humanTitle(n.type),n.severity||'info',n.actionSection||null,n.actionData?JSON.stringify(n.actionData):null,
    n.metadata?JSON.stringify(n.metadata):null,n.deduplicationKey||null,n.createdBy||null];
  if (!params[1]) throw new Error('Notification message is required.');
  const result=await run(
    `INSERT OR IGNORE INTO notifications(userId,message,type,courseId,entityType,entityId,title,severity,actionSection,actionData,metadata,deduplicationKey,createdBy)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, params
  );
  if (!result.changes && n.deduplicationKey) {
    const existing=await get('SELECT * FROM notifications WHERE deduplicationKey=?',[n.deduplicationKey]);
    return { ...existing, duplicate:true };
  }
  return get('SELECT * FROM notifications WHERE id=?',[result.id]);
}

async function recordFailure(n, err) {
  try { await run(`INSERT INTO notification_delivery_failures(recipientUserId,type,entityType,entityId,error,deduplicationKey) VALUES(?,?,?,?,?,?)`,
    [n.recipientUserId||null,n.type||null,n.entityType||null,n.entityId||null,String(err.message||err).slice(0,1000),n.deduplicationKey||null]); }
  catch { /* diagnostics must never become a second failure */ }
  console.error(`Optional notification delivery failed (${n.type || 'unknown'}):`, err.message || err);
}

async function safeCreateNotification(args, legacyMessage, legacyType, legacyMeta) {
  const n=normalize(args,legacyMessage,legacyType,legacyMeta);
  try { return await createNotification(n); }
  catch(err){ await recordFailure(n,err); return { failed:true,error:err.message }; }
}

async function createBulkNotifications({ recipientUserIds, deduplicationKeyPrefix, ...base }) {
  const unique=[...new Set((recipientUserIds||[]).map(Number).filter(Number.isFinite))], results=[];
  for(const recipientUserId of unique){
    // Independent delivery is deliberate: one invalid recipient cannot suppress everyone else.
    // eslint-disable-next-line no-await-in-loop
    results.push(await safeCreateNotification({ ...base,recipientUserId,deduplicationKey:deduplicationKeyPrefix?`${deduplicationKeyPrefix}:${recipientUserId}`:base.deduplicationKey }));
  }
  return results;
}

module.exports={NOTIFICATION_TYPES,SEVERITIES,OPTIONAL_CATEGORIES,MANDATORY_TYPES,createNotification,safeCreateNotification,createBulkNotifications};
