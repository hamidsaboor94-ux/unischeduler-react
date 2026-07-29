const { all } = require('./db');
const { getGradingScale } = require('./gradingScale');

/** Credit-weighted GPA + credits attempted/completed for a student, optionally scoped to one
    term (courses.termId) — pass { termId } to get a single semester's numbers instead of the
    cumulative (CGPA) picture. Resolved live against whichever grading scale is current right
    now, same "never stale" approach as gradingScale.js's recomputeFinalGrade. Only counts
    currently-enrolled rows (status = 'enrolled'), same proxy every other academic read in this
    app already relies on. */
async function computeAcademicSummary(studentId, { termId } = {}) {
  const rows = await all(
    `SELECT e.grade, c.credits FROM enrollments e JOIN courses c ON c.id = e.courseId
     WHERE e.studentId = ? AND e.status = 'enrolled'${termId ? ' AND c.termId = ?' : ''}`,
    termId ? [studentId, termId] : [studentId]
  );
  const scale = await getGradingScale();
  let qualityPoints = 0, gpaCredits = 0, completedCredits = 0, attemptedCredits = 0, failedCount = 0;
  for (const r of rows) {
    const credits = r.credits || 0;
    attemptedCredits += credits;
    if (r.grade) {
      completedCredits += credits;
      const band = scale.find(b => b.label === r.grade);
      qualityPoints += (band?.point ?? 0) * credits;
      gpaCredits += credits;
      if (r.grade === 'F') failedCount += 1;
    }
  }
  return {
    gpa: gpaCredits > 0 ? Math.round((qualityPoints / gpaCredits) * 100) / 100 : null,
    completedCredits,
    attemptedCredits,
    gradedCount: rows.filter(r => r.grade != null).length,
    totalCount: rows.length,
    failedCount,
  };
}

module.exports = { computeAcademicSummary };
