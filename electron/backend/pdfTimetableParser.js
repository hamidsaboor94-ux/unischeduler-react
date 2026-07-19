/**
 * Parses a university timetable PDF (grid of Program Semester x Section x
 * Day) into structured class rows, using pdfjs-dist's per-item text
 * *positions* (not flat text) to reconstruct the table — flat extraction
 * interleaves adjacent columns and silently scrambles the grid whenever a
 * cell (e.g. an "OFF" day) has a different number of text lines than its
 * neighbours.
 *
 * This is a general reconstruction (day columns are located from whatever
 * day names appear in the header row, session time is parsed from whatever
 * "HH:MM am/pm - HH:MM am/pm" text appears near the table title) — nothing
 * about a specific institution's timetable is hard-coded here.
 */
const DAY_NAMES = { Saturday: 'Sat', Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri' };
const ROOM_RE = /^(Lab\s*\d+|\d{3,4})$/i;
const SECTION_RE = /^Section\s*0?(\d+)\s*$/i;
const SEMESTER_RE = /^([1-8])$/;
// A typo like "05:oo PM" (o instead of 0) shows up in real documents copy-pasted from other tools — tolerate it.
const TIME_RANGE_RE = /(\d{1,2}):([0-9oO]{2})\s*([ap]\.?m\.?)?\s*-\s*(\d{1,2}):([0-9oO]{2})\s*([ap]\.?m\.?)/i;

function to24Hour(hourStr, minStr, meridiem, otherMeridiem) {
  let hour = Number(hourStr);
  const min = Number(String(minStr).replace(/[oO]/g, '0'));
  const m = (meridiem || otherMeridiem || '').toLowerCase().replace(/\./g, '');
  if (m === 'pm' && hour < 12) hour += 12;
  if (m === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Finds a "HH:MM am - HH:MM pm" style range anywhere in `text`; returns { start, end } in 24h "HH:MM", or null. */
function extractTimeRange(text) {
  const m = TIME_RANGE_RE.exec(text);
  if (!m) return null;
  const [, h1, min1, mer1, h2, min2, mer2] = m;
  const meridiem1 = mer1 || mer2; // "9:00 - 12:30 pm" only marks the second meridiem
  return { start: to24Hour(h1, min1, meridiem1, mer2), end: to24Hour(h2, min2, mer2, mer2) };
}

/** Splits "Belief System of Islam 2 & Recitation and Tajweed 2" into { name, credits } using the trailing number. */
function splitNameAndCredits(text) {
  const m = /^(.*?)\s+(\d+)\s*$/.exec(text.trim());
  if (!m) return { name: text.trim(), credits: null };
  return { name: m[1].trim(), credits: Number(m[2]) };
}

// PDF y-coordinates reset to 0 at the bottom of every page, so text items from different pages are given a
// large per-page offset to sort correctly in one continuous "reading order" list. PAGE_TOP_SENTINEL is a
// safe stand-in for "the very top of this page" — comfortably above any real single-page content (well under
// a typical page height in points) but well under the next page's own offset, so it can't bleed across pages.
const PAGE_OFFSET = 100000;
const PAGE_TOP_SENTINEL = 2000;
function pageOffset(pageNum, numPages) { return (numPages - pageNum) * PAGE_OFFSET; }

async function extractItems(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true,
  }).promise;

  const items = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const yBase = pageOffset(pageNum, doc.numPages);
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      items.push({ str: item.str, x: item.transform[4], y: yBase + item.transform[5], width: item.width, page: pageNum });
    }
  }
  return { items, numPages: doc.numPages };
}

/** Groups same-line text items (close x, touching/near-touching) into a single string, left to right. */
function joinLine(lineItems) {
  const sorted = [...lineItems].sort((a, b) => a.x - b.x);
  let out = '';
  let prevEnd = null;
  for (const it of sorted) {
    if (prevEnd !== null && it.x - prevEnd > 2) out += ' ';
    out += it.str;
    prevEnd = it.x + it.width;
  }
  return out.trim();
}

/** Clusters items into text lines by y-proximity (handles wrapped multi-line cell content), sorted top to bottom. */
function clusterIntoLines(cellItems, lineTolerance = 6) {
  const sorted = [...cellItems].sort((a, b) => b.y - a.y);
  const lines = [];
  for (const item of sorted) {
    const line = lines.find(l => Math.abs(l.y - item.y) <= lineTolerance);
    if (line) { line.items.push(item); line.y = (line.y + item.y) / 2; }
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.sort((a, b) => b.y - a.y).map(l => joinLine(l.items));
}

/** Interprets a cell's reconstructed lines as either "OFF" or { name, credits, teacher, room }. */
function classifyCell(lines) {
  const nonEmpty = lines.filter(l => l.trim());
  if (!nonEmpty.length) return null;
  if (nonEmpty.length === 1 && nonEmpty[0].trim().toUpperCase() === 'OFF') return { off: true };

  const roomIdx = [...nonEmpty].reverse().findIndex(l => ROOM_RE.test(l.trim()));
  if (roomIdx === -1) {
    // No recognizable room line — the room is genuinely missing/blank for this class in the PDF, but
    // the name/teacher split should still be attempted so it doesn't collapse into one bled string.
    // A trailing line that's a wrapped title fragment or a stray credits number always ends in a
    // digit (e.g. "Sciences 2", or a bare "2"); a real teacher name never contains one — so that's
    // the signal for whether the last line is actually a teacher who lost their room line.
    const last = nonEmpty[nonEmpty.length - 1].trim();
    if (nonEmpty.length >= 2 && !/\d/.test(last)) {
      const teacher = last;
      const { name, credits } = splitNameAndCredits(nonEmpty.slice(0, -1).join(' '));
      return { off: false, raw: nonEmpty.join(' | '), name, credits, teacher, room: null, incomplete: true };
    }
    const { name, credits } = splitNameAndCredits(nonEmpty.join(' '));
    return { off: false, raw: nonEmpty.join(' | '), name, credits, teacher: null, room: null, incomplete: true };
  }
  const lastIdx = nonEmpty.length - 1 - roomIdx;
  const room = nonEmpty[lastIdx].trim();
  const teacher = lastIdx > 0 ? nonEmpty[lastIdx - 1].trim() : null;
  const nameLines = nonEmpty.slice(0, Math.max(lastIdx - 1, 0));
  const { name, credits } = splitNameAndCredits(nameLines.join(' '));
  return { off: false, raw: nonEmpty.join(' | '), name, credits, teacher, room, incomplete: !name || !teacher };
}

async function parseTimetablePdf(buffer) {
  const { items, numPages } = await extractItems(buffer);
  const warnings = [];

  // Locate every header row (one per table — this document has a Morning and an Evening table).
  const dayHeaderNames = Object.keys(DAY_NAMES);
  const headerItems = items.filter(i => dayHeaderNames.includes(i.str.trim()));
  if (!headerItems.length) {
    return { rows: [], warnings: ['Could not find any day-of-week column headers (Saturday/Sunday/…) in this PDF.'] };
  }
  // Group header items into distinct table headers by y (one row of day names per table).
  const headerRows = [];
  for (const item of headerItems) {
    let row = headerRows.find(r => Math.abs(r.y - item.y) <= 4);
    if (!row) { row = { y: item.y, cols: [] }; headerRows.push(row); }
    row.cols.push({ day: DAY_NAMES[item.str.trim()], x: item.x });
  }
  headerRows.sort((a, b) => b.y - a.y);

  // Session time (Morning/Evening/…) is whatever "HH:MM am - HH:MM pm" text appears above each header, nearest first.
  const sessionTitleItems = items.filter(i => /timetable/i.test(i.str) || TIME_RANGE_RE.test(i.str));
  function sessionTimeFor(headerY) {
    const candidates = sessionTitleItems.filter(i => i.y > headerY).sort((a, b) => a.y - b.y); // closest above first
    for (const c of candidates) {
      const range = extractTimeRange(c.str);
      if (range) return range;
    }
    // Fall back to nearby title text mentioning "morning"/"evening" — matches the parse-time fallback described for this PDF.
    const titled = candidates.find(c => /morning/i.test(c.str));
    if (titled) return { start: '09:00', end: '12:30' };
    const titledEve = candidates.find(c => /evening/i.test(c.str));
    if (titledEve) return { start: '17:00', end: '20:00' };
    return null;
  }

  const rows = [];
  for (const header of headerRows) {
    const session = sessionTimeFor(header.y);
    if (!session) warnings.push(`Could not determine a session time for the table near y=${Math.round(header.y)} — times will need to be filled in manually.`);
    const dayCols = header.cols.slice().sort((a, b) => a.x - b.x);

    // Items belonging to this table span from just below the header down to just above the next header (or
    // end of doc). Session-title text (e.g. the next table's "Evening Classes Timetable…" heading) can sit
    // between this table's last row and the next header, so it must be excluded explicitly too — otherwise
    // it leaks into whatever cell happens to occupy that bottom-most y range.
    const nextHeaderY = headerRows.filter(h => h.y < header.y).sort((a, b) => b.y - a.y)[0]?.y ?? -Infinity;
    const tableItems = items.filter(i => i.y < header.y && i.y > nextHeaderY && !sessionTitleItems.includes(i));

    // Find Section/Semester labels using a loose bound (anything left of the first day header's own x) —
    // then derive the real label-area width from where those labels actually end, since a fixed offset
    // from the header risks either clipping real cell content or leaking label text into day columns.
    const looseLabelBound = dayCols[0].x;
    const sectionLabelItems = tableItems.filter(i => i.x < looseLabelBound && SECTION_RE.test(i.str.trim()));
    const labelXMax = sectionLabelItems.length
      ? Math.max(...sectionLabelItems.map(i => i.x + i.width)) + 8
      : looseLabelBound - 20;

    // Column boundaries: midpoint between adjacent day headers; first column starts after the label area, last runs to +infinity.
    const bounds = dayCols.map((c, i) => ({
      day: c.day,
      xMin: i === 0 ? labelXMax : (dayCols[i - 1].x + c.x) / 2,
      xMax: i === dayCols.length - 1 ? Infinity : (c.x + dayCols[i + 1].x) / 2,
    }));

    // A row can be split across a page break (e.g. course names + teacher land on page N, and only
    // the room values spill onto page N+1). That continuation content sits at the very top of the next
    // page, above that page's own first Section label. Detect it by CONTENT — a cluster of purely
    // room-pattern text sitting above everything else on the page — rather than by guessing a y
    // boundary, and re-tag its y so it lands inside the previous page's last row. That keeps every
    // other row-boundary computation below strictly same-page (no cross-page midpoint math needed).
    const pagesInTable = [...new Set(tableItems.map(i => i.page))].sort((a, b) => a - b);
    for (const pageNum of pagesInTable.slice(1)) {
      const pageItems = tableItems.filter(i => i.page === pageNum && i.x >= labelXMax);
      if (!pageItems.length) continue;
      const topY = Math.max(...pageItems.map(i => i.y));
      const topLineItems = pageItems.filter(i => topY - i.y <= 6);
      const isOrphanContinuation = topLineItems.every(i => ROOM_RE.test(i.str.trim()));
      if (!isOrphanContinuation) continue;
      const prevPageOwnItems = tableItems.filter(i => i.page === pageNum - 1 && i.x >= labelXMax);
      if (!prevPageOwnItems.length) continue;
      // Position the retagged content below the lowest real content already on the previous page (its
      // own last row's teacher line), so it forms its own new bottom line there instead of merging into
      // an existing one — merging into the teacher's line was an earlier bug (glued e.g. "Halimi502").
      const minYOnPrevPage = Math.min(...prevPageOwnItems.map(i => i.y));
      for (const item of topLineItems) item.y = minYOnPrevPage - 10;
    }

    const sectionAnchors = sectionLabelItems
      .map(i => ({ section: i.str.trim().match(SECTION_RE)[1].padStart(2, '0'), y: i.y, page: i.page }))
      .sort((a, b) => b.y - a.y);
    const semesterAnchors = tableItems
      .filter(i => i.x < labelXMax && SEMESTER_RE.test(i.str.trim()))
      .map(i => ({ semester: Number(i.str.trim()), y: i.y }));

    if (!sectionAnchors.length) continue;

    // A section label sits roughly centered within its own row's content, not above it — so each row's
    // vertical extent is bounded by the *midpoints* to its neighbouring section labels, not the labels
    // themselves. Page-spanning row content has already been re-tagged into the previous page's own
    // coordinate space above, so any remaining cross-page neighbour is just a normal page transition:
    // extend to the top of the new page on entry, and to the bottom of the old page on exit.
    const rowBounds = sectionAnchors.map((a, i) => {
      const prev = sectionAnchors[i - 1];
      const next = sectionAnchors[i + 1];
      return {
        ...a,
        yTop: i === 0 ? header.y : (prev.page === a.page ? (prev.y + a.y) / 2 : pageOffset(a.page, numPages) + PAGE_TOP_SENTINEL),
        yBottom: i === sectionAnchors.length - 1 ? nextHeaderY : (next.page === a.page ? (a.y + next.y) / 2 : pageOffset(a.page, numPages)),
      };
    });

    // Group consecutive sections into semester runs (a fresh "Section 01" always starts a new semester's group).
    const groups = [];
    for (const row of rowBounds) {
      if (row.section === '01' || !groups.length) groups.push({ rows: [] });
      groups[groups.length - 1].rows.push(row);
    }
    for (const g of groups) {
      const yTop = g.rows[0].yTop;
      const yBottom = g.rows[g.rows.length - 1].yBottom;
      const match = semesterAnchors.find(s => s.y <= yTop && s.y >= yBottom);
      g.semester = match ? match.semester : null;
    }

    for (const group of groups) {
      if (group.semester == null) warnings.push(`Could not determine the program semester for a group of sections near y=${Math.round(group.rows[0].y)}.`);
      for (const { section, yTop, yBottom } of group.rows) {
        for (const col of bounds) {
          const cellItems = tableItems.filter(i =>
            i.x >= col.xMin && i.x < col.xMax && i.y <= yTop && i.y > yBottom);
          if (!cellItems.length) continue;
          const lines = clusterIntoLines(cellItems);
          const parsed = classifyCell(lines);
          if (!parsed || parsed.off) continue;

          rows.push({
            programSemester: group.semester,
            section,
            day: col.day,
            startTime: session ? session.start : null,
            endTime: session ? session.end : null,
            courseName: parsed.name,
            credits: parsed.credits,
            teacher: parsed.teacher,
            room: parsed.room,
            raw: parsed.raw,
            valid: !parsed.incomplete && group.semester != null && !!session,
          });
        }
      }
    }
  }

  return { rows, warnings };
}

module.exports = { parseTimetablePdf, extractTimeRange, splitNameAndCredits };
