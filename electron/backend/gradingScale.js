const { all, get, run } = require('./db');

/** Sensible out-of-the-box scale, used until an admin saves their own. Sums to full 0-100
    coverage (the lowest band always starts at 0) — see validateScale below. `point` is the
    standard 4.0-scale grade point used for the Student Profile's cumulative GPA — resolved
    live against whichever scale is current, same as the letter grade itself never being
    stored stale. */
const DEFAULT_GRADING_SCALE = [
  { label: 'A', min: 90, point: 4 },
  { label: 'B', min: 80, point: 3 },
  { label: 'C', min: 70, point: 2 },
  { label: 'D', min: 60, point: 1 },
  { label: 'F', min: 0, point: 0 },
];

async function getGradingScale() {
  const row = await get("SELECT value FROM settings WHERE key = 'gradingScale'", []);
  if (!row || !row.value) return DEFAULT_GRADING_SCALE;
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_GRADING_SCALE;
  } catch {
    return DEFAULT_GRADING_SCALE;
  }
}

/** Bands must fully and unambiguously cover 0-100: each has a non-empty label and a numeric
    min in [0,100], no two bands share a min, and — once sorted — the lowest band starts at 0
    (otherwise a low score would match no band at all). */
function validateScale(bands) {
  if (!Array.isArray(bands) || !bands.length) return 'At least one grade band is required.';
  for (const b of bands) {
    if (!b || typeof b.label !== 'string' || !b.label.trim()) return 'Every band needs a label.';
    if (typeof b.min !== 'number' || Number.isNaN(b.min) || b.min < 0 || b.min > 100) {
      return 'Every band\'s minimum score must be a number between 0 and 100.';
    }
    if (typeof b.point !== 'number' || Number.isNaN(b.point) || b.point < 0) {
      return 'Every band needs a non-negative grade point value.';
    }
  }
  const mins = bands.map(b => b.min);
  if (new Set(mins).size !== mins.length) return 'Two bands can\'t share the same minimum score.';
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  if (sorted[sorted.length - 1].min !== 0) return 'Your lowest band must start at 0, so every score maps to a grade.';
  return null;
}

/** First band (highest min first) that `percent` clears. Assumes a validated scale (lowest
    band at 0), so this always finds a match for any percent in [0,100]. */
function letterForPercent(percent, scale) {
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  const band = sorted.find(b => percent >= b.min);
  return band ? band.label : null;
}

/** Recomputes and persists one student's final letter grade for one course, straight onto
    enrollments.grade — the single column every other read (roster, /me, prerequisite checks)
    already relies on. Null when the course isn't fully scored yet (any grade_items row still
    unscored for this student), so a stale letter never lingers past an incomplete gradebook. */
async function recomputeFinalGrade(courseId, studentId) {
  const items = await all('SELECT id, maxScore FROM grade_items WHERE courseId = ?', [courseId]);
  let letter = null;
  if (items.length) {
    const scores = await all(
      `SELECT gradeItemId, score FROM grade_scores WHERE studentId = ? AND gradeItemId IN (${items.map(() => '?').join(',')})`,
      [studentId, ...items.map(i => i.id)]
    );
    const scoreMap = new Map(scores.map(s => [s.gradeItemId, s.score]));
    const allScored = items.every(item => scoreMap.get(item.id) != null);
    if (allScored) {
      const totalPossible = items.reduce((sum, i) => sum + i.maxScore, 0);
      const totalEarned = items.reduce((sum, i) => sum + scoreMap.get(i.id), 0);
      if (totalPossible > 0) {
        const percent = (totalEarned / totalPossible) * 100;
        letter = letterForPercent(percent, await getGradingScale());
      }
    }
  }
  await run('UPDATE enrollments SET grade = ? WHERE courseId = ? AND studentId = ?', [letter, courseId, studentId]);
  return letter;
}

/** Recomputes every currently-enrolled student's final grade for a course — used after a
    grade_items change (add/edit/delete), since that changes everyone's completeness picture
    at once, not just the student whose score was just edited. */
async function recomputeFinalGradesForCourse(courseId) {
  const students = await all(`SELECT DISTINCT studentId FROM enrollments WHERE courseId = ? AND status = 'enrolled'`, [courseId]);
  for (const s of students) await recomputeFinalGrade(courseId, s.studentId);
}

module.exports = { DEFAULT_GRADING_SCALE, getGradingScale, validateScale, letterForPercent, recomputeFinalGrade, recomputeFinalGradesForCourse };
