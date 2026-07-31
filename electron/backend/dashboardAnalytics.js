/**
 * The Reports page's analytics queries (room utilization, course popularity, teacher workload,
 * enrollment trends, admissions summary) — pulled out of routes/reports.js so both the live page
 * (GET /reports) and the PDF/Excel dashboard export (see dashboardExport.js) call the exact same
 * query path instead of two copies of this SQL drifting apart.
 */
const { get, all } = require('./db');

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** termId scopes room utilization, course popularity, and teacher workload to a single term
    (resolves to the currently active one when omitted); enrollment trends are intentionally
    term-independent, covering every term so growth/decline is visible across semesters. */
async function computeDashboardData(termIdInput) {
  let termId = termIdInput ? Number(termIdInput) : null;
  if (!termId) {
    const active = await get('SELECT id FROM terms WHERE isActive = 1 ORDER BY id DESC LIMIT 1');
    termId = active ? active.id : null;
  }

  const rooms = await all('SELECT id, name, type, capacity FROM rooms ORDER BY name');
  const roomSlots = termId
    ? await all(
        `SELECT ts.roomId, ts.day, ts.durationMinutes
         FROM timetable_slots ts WHERE ts.termId = ? AND ts.roomId IS NOT NULL`,
        [termId]
      )
    : [];
  const roomUtilization = rooms.map(r => {
    const byDay = Object.fromEntries(DAYS.map(d => [d, 0]));
    let totalMinutes = 0;
    let sessions = 0;
    for (const s of roomSlots) {
      if (s.roomId !== r.id) continue;
      const mins = s.durationMinutes || 60;
      if (byDay[s.day] !== undefined) byDay[s.day] += mins;
      totalMinutes += mins;
      sessions += 1;
    }
    return {
      roomId: r.id, name: r.name, type: r.type, capacity: r.capacity,
      sessions, weeklyHours: Math.round((totalMinutes / 60) * 10) / 10,
      byDay: Object.fromEntries(DAYS.map(d => [d, Math.round((byDay[d] / 60) * 10) / 10])),
    };
  }).sort((a, b) => b.weeklyHours - a.weeklyHours);

  const coursePopularity = termId
    ? (await all(
        `SELECT c.id as courseId, c.code, c.name,
                COUNT(CASE WHEN e.status = 'enrolled' THEN 1 END) as enrolledCount,
                COUNT(CASE WHEN e.status = 'waitlisted' THEN 1 END) as waitlistedCount,
                c.maxStudents
         FROM courses c
         LEFT JOIN enrollments e ON e.courseId = c.id
         WHERE c.termId = ?
         GROUP BY c.id
         ORDER BY enrolledCount DESC`,
        [termId]
      ))
    : [];

  const teacherWorkload = termId
    ? (await all(
        `SELECT t.id as teacherId, t.name,
                COUNT(DISTINCT c.id) as sections,
                COALESCE(SUM(ts.durationMinutes), 0) as totalMinutes
         FROM teachers t
         LEFT JOIN courses c ON c.teacherId = t.id AND c.termId = ?
         LEFT JOIN timetable_slots ts ON ts.courseId = c.id
         GROUP BY t.id
         ORDER BY totalMinutes DESC`,
        [termId]
      )).map(row => ({
        teacherId: row.teacherId, name: row.name, sections: row.sections,
        weeklyHours: Math.round((row.totalMinutes / 60) * 10) / 10,
      }))
    : [];

  const enrollmentTrends = await all(
    `SELECT t.id as termId, t.name as termName, t.startDate,
            COUNT(CASE WHEN e.status = 'enrolled' THEN 1 END) as totalEnrolled
     FROM terms t
     LEFT JOIN courses c ON c.termId = t.id
     LEFT JOIN enrollments e ON e.courseId = c.id
     GROUP BY t.id
     ORDER BY t.startDate IS NULL, t.startDate, t.id`
  );

  // Term-independent, like enrollmentTrends — admissions isn't scoped to a single term.
  const statusCounts = await all('SELECT status, COUNT(*) as n FROM applications GROUP BY status');
  const countOf = (status) => statusCounts.find(s => s.status === status)?.n || 0;
  const total = statusCounts.reduce((sum, s) => sum + s.n, 0);
  const accepted = countOf('Accepted');
  const rejected = countOf('Rejected');
  const pending = total - accepted - rejected;
  const decided = accepted + rejected;
  const applicationStats = {
    total, accepted, rejected, pending,
    acceptanceRate: decided > 0 ? Math.round((accepted / decided) * 1000) / 10 : null,
  };

  return { termId, roomUtilization, coursePopularity, teacherWorkload, enrollmentTrends, applicationStats };
}

module.exports = { computeDashboardData, DAYS };
