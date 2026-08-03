/** Periodic sweep that makes scheduling/expiry reliable without depending on any browser being
    open (per the "Send Now / Schedule for Later" requirement) — this Node process is already
    long-running (see index.js), so a simple interval is enough; no external job queue needed. */
const { all, run, logAudit } = require('./db');
const { publishNotice } = require('./noticePublish');
const { createBulkNotifications } = require('./notificationTypes');

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
    await runLifecycleReminders();
  } catch (err) {
    console.error('Notice scheduler sweep failed:', err.message);
  }
}

async function runLifecycleReminders(){
  const day=new Date().toISOString().slice(0,10);
  const assignments=await all(`SELECT a.id,a.title,a.courseId,c.code FROM assignments a JOIN courses c ON c.id=a.courseId WHERE datetime(a.dueDate)>CURRENT_TIMESTAMP AND datetime(a.dueDate)<=datetime(CURRENT_TIMESTAMP,'+24 hours')`);
  for(const a of assignments){const recipients=await all(`SELECT studentId id FROM enrollments WHERE courseId=? AND status='enrolled'`,[a.courseId]);await createBulkNotifications({recipientUserIds:recipients.map(x=>x.id),type:'assignment_due_soon',title:'Assignment due soon',message:`“${a.title}” in ${a.code} is due within 24 hours.`,severity:'warning',entityType:'assignment',entityId:a.id,courseId:a.courseId,actionSection:'catalog',actionData:{courseId:a.courseId,assignmentId:a.id},deduplicationKeyPrefix:`reminder:${day}:assignment:${a.id}:24h`,category:'assignment_reminders'});}
  const exams=await all(`SELECT e.*,c.code FROM exams e JOIN courses c ON c.id=e.courseId WHERE date(e.date)=date('now','+1 day') AND e.time IS NOT NULL`);
  for(const e of exams){const recipients=await all(`SELECT studentId id FROM enrollments WHERE courseId=? AND status='enrolled'`,[e.courseId]);await createBulkNotifications({recipientUserIds:recipients.map(x=>x.id),type:'exam_reminder',title:'Exam tomorrow',message:`${e.code} ${e.type} is scheduled tomorrow at ${e.time}.`,severity:'warning',entityType:'exam',entityId:e.id,courseId:e.courseId,actionSection:'exams',actionData:{examId:e.id},deduplicationKeyPrefix:`reminder:${day}:exam:${e.id}:1d`,category:'academic_updates'});}
  const terms=await all(`SELECT id,name FROM terms WHERE registrationClosesAt>CURRENT_TIMESTAMP AND registrationClosesAt<=datetime(CURRENT_TIMESTAMP,'+24 hours')`);
  for(const term of terms){const recipients=await all(`SELECT DISTINCT e.studentId id FROM enrollments e JOIN courses c ON c.id=e.courseId WHERE c.termId=? AND e.status IN ('enrolled','waitlisted')`,[term.id]);await createBulkNotifications({recipientUserIds:recipients.map(x=>x.id),type:'registration_deadline',title:'Registration closes soon',message:`Registration for ${term.name} closes within 24 hours.`,severity:'warning',entityType:'term',entityId:term.id,actionSection:'catalog',deduplicationKeyPrefix:`reminder:${day}:registration:${term.id}:24h`,category:'academic_updates'});}
  const installments=await all(`SELECT i.id,i.studentId,i.dueDate,i.status FROM installments i WHERE i.status!='paid' AND date(i.dueDate)<=date('now','+3 day')`);
  for(const i of installments){const overdue=new Date(i.dueDate)<new Date();await createBulkNotifications({recipientUserIds:[i.studentId],type:overdue?'installment_overdue':'installment_due',title:overdue?'Installment overdue':'Installment due soon',message:overdue?'A university installment is overdue. Open your protected finance page for details.':'A university installment is due within three days. Open your protected finance page for details.',severity:overdue?'critical':'warning',entityType:'installment',entityId:i.id,actionSection:'my-fees',deduplicationKeyPrefix:`reminder:${day}:installment:${i.id}:${overdue?'overdue':'3d'}`,category:'finance_reminders'});}
  const pending=await all(`SELECT ar.id,ar.type,acs.role,acs.stepOrder FROM approval_requests ar JOIN approval_chain_steps acs ON acs.type=ar.type AND acs.stepOrder=ar.currentStepOrder WHERE ar.status='In Review'`);
  for(const p of pending){const users=await all('SELECT id FROM users WHERE role=?',[p.role]);await createBulkNotifications({recipientUserIds:users.map(x=>x.id),type:'approval_queue_entered',title:'Pending approval reminder',message:`A ${p.type} request is waiting for review.`,severity:'warning',entityType:'approval_request',entityId:p.id,actionSection:'approvals',deduplicationKeyPrefix:`reminder:${day}:approval:${p.id}:${p.stepOrder}`});}
  // Courses whose term is closing need one daily records/faculty reminder until results are
  // formally published. Draft gradebook edits never notify students.
  const unpublished = await all(
    `SELECT c.id,c.code,t.userId teacherUserId FROM courses c
     JOIN terms tm ON tm.id=c.termId
     LEFT JOIN teachers t ON t.id=c.teacherId
     WHERE c.resultsPublishedAt IS NULL
       AND date(tm.endDate) BETWEEN date('now') AND date('now','+3 day')
       AND EXISTS(SELECT 1 FROM enrollments e WHERE e.courseId=c.id AND e.status='enrolled')`
  );
  const recordsStaff = await all(`SELECT id FROM users WHERE role IN ('registrar','records_officer')`);
  for (const course of unpublished) {
    await createBulkNotifications({
      recipientUserIds: [course.teacherUserId, ...recordsStaff.map(user => user.id)],
      type: 'grade_incomplete', title: 'Final results still unpublished',
      message: `${course.code} still requires formal result publication as the term closes.`, severity: 'warning',
      entityType: 'course', entityId: course.id, courseId: course.id, actionSection: 'grades',
      actionData: { courseId: course.id }, deduplicationKeyPrefix: `reminder:${day}:unpublished-grades:${course.id}`
    });
  }
  // Once today's scheduled class time passes, remind only the responsible instructor if no
  // attendance row exists for that slot. Repeated scheduler sweeps share the same daily key.
  const unmarked = await all(
    `SELECT s.id,c.id courseId,c.code,t.userId teacherUserId FROM timetable_slots s
     JOIN courses c ON c.id=s.courseId JOIN terms tm ON tm.id=c.termId
     LEFT JOIN teachers t ON t.id=c.teacherId
     WHERE tm.isActive=1 AND s.day=CASE strftime('%w','now','localtime')
       WHEN '0' THEN 'Sunday' WHEN '1' THEN 'Monday' WHEN '2' THEN 'Tuesday'
       WHEN '3' THEN 'Wednesday' WHEN '4' THEN 'Thursday' WHEN '5' THEN 'Friday' ELSE 'Saturday' END
       AND time(s.time)<time('now','localtime') AND t.userId IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM attendance a WHERE a.slotId=s.id AND date(a.date)=date('now','localtime'))`
  );
  for (const slot of unmarked) {
    await createBulkNotifications({
      recipientUserIds: [slot.teacherUserId], type: 'attendance_unmarked', title: 'Attendance not yet marked',
      message: `Today's attendance for ${slot.code} has not been recorded.`, severity: 'warning',
      entityType: 'timetable_slot', entityId: slot.id, courseId: slot.courseId, actionSection: 'attendance',
      actionData: { courseId: slot.courseId, slotId: slot.id }, deduplicationKeyPrefix: `reminder:${day}:unmarked-attendance:${slot.id}`
    });
  }
}

module.exports = { runNoticeScheduler };
