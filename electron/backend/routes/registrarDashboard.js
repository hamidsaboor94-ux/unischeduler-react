const express = require('express');
const { all, get } = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { countStudentsWithHold } = require('../finance');

const router = express.Router();

/** Registrar dashboard KPI/queue counts — a read-only aggregate surface over data owned by
 *  admissions/enrollment/finance (applications, enrollments, finance_transactions), none of
 *  which the registrar role has general module access to (see permissions.js). Mounted directly
 *  behind requireRole('registrar', 'admin') in app.js rather than requireModuleAccess, so this
 *  endpoint returns counts only — never raw applicant or billing records — without granting
 *  registrar the Applications/Finance pages themselves. */
router.get('/', asyncHandler(async (req, res) => {
  const term = await get('SELECT * FROM terms WHERE isActive = 1 ORDER BY id DESC LIMIT 1');

  const { count: activeStudents } = await get(`SELECT COUNT(*) as count FROM users WHERE role = 'student'`);
  const { count: newAdmitsPending } = await get(
    `SELECT COUNT(*) as count FROM applications WHERE status NOT IN ('Accepted', 'Rejected')`
  );

  let registeredThisTerm = 0;
  let notRegisteredThisTerm = activeStudents;
  let sectionsOverCapacity = 0;
  if (term) {
    const registeredRow = await get(
      `SELECT COUNT(DISTINCT e.studentId) as count FROM enrollments e
       JOIN courses c ON c.id = e.courseId
       JOIN users u ON u.id = e.studentId AND u.role = 'student'
       WHERE c.termId = ? AND e.status IN ('enrolled', 'waitlisted') AND e.deletedAt IS NULL`,
      [term.id]
    );
    registeredThisTerm = registeredRow.count;

    const notRegisteredRow = await get(
      `SELECT COUNT(*) as count FROM users u WHERE u.role = 'student' AND u.id NOT IN (
         SELECT e.studentId FROM enrollments e JOIN courses c ON c.id = e.courseId
         WHERE c.termId = ? AND e.status IN ('enrolled', 'waitlisted') AND e.deletedAt IS NULL
       )`,
      [term.id]
    );
    notRegisteredThisTerm = notRegisteredRow.count;

    const overCapacityRow = await get(
      `SELECT COUNT(*) as count FROM (
         SELECT c.id, COUNT(CASE WHEN e.status = 'enrolled' THEN 1 END) as enrolledCount
         FROM courses c LEFT JOIN enrollments e ON e.courseId = c.id
         WHERE c.termId = ? AND c.maxStudents IS NOT NULL
         GROUP BY c.id HAVING enrolledCount > c.maxStudents
       )`,
      [term.id]
    );
    sectionsOverCapacity = overCapacityRow.count;
  }

  const { count: newAdmitsAwaitingEnrollment } = await get(
    `SELECT COUNT(*) as count FROM applications a
     WHERE a.status = 'Accepted' AND a.createdStudentId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.studentId = a.createdStudentId AND e.deletedAt IS NULL)`
  );
  const { count: noApplicationRecord } = await get(
    `SELECT COUNT(*) as count FROM users u
     WHERE u.role = 'student' AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.createdStudentId = u.id)`
  );

  const holdsCount = await countStudentsWithHold();

  res.json({
    term: term || null,
    kpis: {
      activeStudents,
      newAdmitsPending,
      registeredThisTerm,
      totalActiveStudents: activeStudents,
      // Financial holds (aggregate outstanding balance > 0) — not a dedicated registration-block
      // system, which doesn't exist yet (see hasFinancialHold, which only gates exam access).
      financialHolds: holdsCount,
      // No add/drop or prerequisite-override request queue exists in this schema yet — staff
      // overrides happen inline in one HTTP call (enrollments.js `override`), never persisted as
      // a pending item. Rendered as a real, honest 0 rather than a fabricated placeholder.
      pendingRequests: 0,
      pendingRequestsImplemented: false,
    },
    queue: {
      notRegisteredThisTerm,
      newAdmitsAwaitingEnrollment,
      noApplicationRecord,
      sectionsOverCapacity,
      addDropRequests: 0,
      addDropRequestsImplemented: false,
    },
  });
}));

module.exports = router;
