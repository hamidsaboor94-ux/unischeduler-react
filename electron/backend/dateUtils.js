/**
 * Generates weekday-only ISO date strings within a term's exam period — used as candidate
 * exam dates for auto-scheduling and conflict auto-resolution.
 *
 * Prefers the term's explicit examStartDate/examEndDate (set on the Semester form) when
 * present. Absent that, falls back to the last two weeks of the semester (a reasonable
 * "finals week" default) since exams belong at the end of a term, not the start — and if
 * even the semester's own end date is unknown, falls all the way back to today.
 */
function candidateDates(term, count = 30) {
  let start;
  if (term && term.examStartDate) start = new Date(term.examStartDate);
  else if (term && term.endDate) { start = new Date(term.endDate); start.setDate(start.getDate() - 13); }
  else if (term && term.startDate) start = new Date(term.startDate);
  else start = new Date();

  const endIso = term && (term.examEndDate || term.endDate) ? (term.examEndDate || term.endDate) : null;

  const dates = [];
  const cursor = new Date(start);
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day >= 1 && day <= 5) {
      const iso = cursor.toISOString().slice(0, 10);
      if (endIso && iso > endIso) break;
      dates.push(iso);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

module.exports = { candidateDates };
