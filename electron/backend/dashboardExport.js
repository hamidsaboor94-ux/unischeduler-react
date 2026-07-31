/**
 * Shapes computeDashboardData()'s output (see dashboardAnalytics.js — the same query the live
 * Analytics tab uses) into the {title, columns, rows, chart} shape reportExport.js renders. One
 * named "chart" per panel on the Reports page's Analytics tab.
 */
const { computeDashboardData, DAYS } = require('./dashboardAnalytics');
const { httpError } = require('./reportBuilder');

const SHAPERS = {
  roomUtilization: (data) => ({
    title: 'Room Utilization',
    columns: [
      { key: 'name', label: 'Room' }, { key: 'type', label: 'Type' }, { key: 'capacity', label: 'Capacity' },
      { key: 'sessions', label: 'Sessions' }, { key: 'weeklyHours', label: 'Weekly Hours' },
      ...DAYS.map((d) => ({ key: d, label: d })),
    ],
    rows: data.roomUtilization.map((r) => ({
      name: r.name, type: r.type, capacity: r.capacity, sessions: r.sessions, weeklyHours: r.weeklyHours, ...r.byDay,
    })),
    chart: { type: 'bar', data: data.roomUtilization.map((r) => ({ label: r.name, value: r.weeklyHours })) },
  }),
  coursePopularity: (data) => ({
    title: 'Course Popularity',
    columns: [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' },
      { key: 'enrolledCount', label: 'Enrolled' }, { key: 'waitlistedCount', label: 'Waitlisted' },
      { key: 'maxStudents', label: 'Capacity' },
    ],
    rows: data.coursePopularity,
    chart: { type: 'bar', data: data.coursePopularity.slice(0, 15).map((c) => ({ label: c.code, value: c.enrolledCount })) },
  }),
  teacherWorkload: (data) => {
    const rows = data.teacherWorkload.filter((t) => t.sections > 0);
    return {
      title: 'Teacher Workload',
      columns: [{ key: 'name', label: 'Teacher' }, { key: 'sections', label: 'Sections' }, { key: 'weeklyHours', label: 'Weekly Hours' }],
      rows,
      chart: { type: 'bar', data: rows.map((t) => ({ label: t.name, value: t.weeklyHours })) },
    };
  },
  enrollmentTrends: (data) => ({
    title: 'Enrollment Trends',
    columns: [{ key: 'termName', label: 'Term' }, { key: 'totalEnrolled', label: 'Enrolled' }],
    rows: data.enrollmentTrends.map((e) => ({ termName: e.termName || `Term ${e.termId}`, totalEnrolled: e.totalEnrolled })),
    chart: { type: 'line', data: data.enrollmentTrends.map((e) => ({ label: e.termName || `Term ${e.termId}`, value: e.totalEnrolled })) },
  }),
  applications: (data) => {
    const s = data.applicationStats;
    const rows = [
      { status: 'Total', count: s.total }, { status: 'Accepted', count: s.accepted },
      { status: 'Rejected', count: s.rejected }, { status: 'Pending', count: s.pending },
    ];
    return {
      title: 'Admissions Summary',
      columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Count' }],
      rows,
      chart: { type: 'bar', data: rows.map((r) => ({ label: r.status, value: r.count })) },
    };
  },
};

const DASHBOARD_CHART_KEYS = Object.keys(SHAPERS);

/** Builds {title, columns, rows, chart} for one named dashboard chart, reusing
    computeDashboardData() — the exact same query the live Analytics tab renders from. */
async function buildDashboardExport(chartKey, termId) {
  const shaper = SHAPERS[chartKey];
  if (!shaper) throw httpError(400, `Unknown dashboard chart "${chartKey}". Expected one of: ${DASHBOARD_CHART_KEYS.join(', ')}.`);
  const data = await computeDashboardData(termId);
  return shaper(data);
}

module.exports = { buildDashboardExport, DASHBOARD_CHART_KEYS };
