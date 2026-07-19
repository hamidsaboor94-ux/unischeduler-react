/** Up-to-2-letter initials from a full name — e.g. "Springfield University" -> "SU",
    "Administrator" -> "A". Shared by user avatars and the generated org logo placeholder. */
export function initials(name) {
  return (name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

/** Mixes hex color toward white by `amount` (0-1) — used to derive a lighter accent shade
    from a single admin-picked brand color, the same relationship the default --accent /
    --accent-light pair has in style.css. */
export function lightenHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/** hex -> "rgba(r,g,b,alpha)" — used for the faint --accent-dim background tint. */
export function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_LABELS = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
export const PALETTE = ['blue', 'teal', 'green', 'lime', 'amber', 'orange', 'rose', 'pink', 'purple', 'indigo'];
export const COLOR_HEX = {
  blue: '#60A5FA', teal: '#2DD4BF', green: '#4ADE80', lime: '#A3E635', amber: '#FBBF24',
  orange: '#FB923C', rose: '#FB7185', pink: '#F472B6', purple: '#C084FC', indigo: '#818CF8',
};
export const DURATION_OPTIONS = [
  { v: 30, label: '30 minutes' },
  { v: 60, label: '1 hour' },
  { v: 90, label: '1.5 hours' },
  { v: 120, label: '2 hours' },
  { v: 150, label: '2.5 hours' },
  { v: 180, label: '3 hours' }
];

/** Deterministic on courseId, so the same course always resolves to the same color
    everywhere it appears (course cards, dashboard exam dots) without needing a stored
    column — stable as long as PALETTE's length doesn't change. */
export function courseColor(courseId) { return PALETTE[courseId % PALETTE.length]; }

export function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

export function addMinutes(time, mins) {
  const total = timeToMinutes(time) + mins;
  const hh = Math.floor(total / 60) % 24, mm = ((total % 60) + 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function overlapsMinutes(aStart, aDurMin, bStart, bDurMin) {
  const as = timeToMinutes(aStart), ae = as + aDurMin;
  const bs = timeToMinutes(bStart), be = bs + bDurMin;
  return as < be && bs < ae;
}

export function fmt12Hour(time) {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function withinNextDays(dateStr, days) {
  if (!dateStr) return false;
  const diff = (new Date(dateStr + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24);
  return diff >= -1 && diff <= days;
}

/** A class is "Morning" or "Evening" purely for the session filter — a display-side split, not a schema concept. */
export function slotSession(time) { return timeToMinutes(time) < 14 * 60 ? 'Morning' : 'Evening'; }

/** Program semester and session actually live on timetable_slots, not on courses or exams — a
    course inherits them from its own weekly class slot(s). If a course somehow has multiple
    slots with different values (no DB constraint forbids it), the first one found wins. Null
    when the course has no slot yet (e.g. exam-only or not yet timetabled). */
export function courseProgramSemester(slots, courseId) {
  const slot = slots.find(s => s.courseId === courseId);
  return slot?.programSemester ?? null;
}
export function courseSession(slots, courseId) {
  const slot = slots.find(s => s.courseId === courseId);
  return slot ? slotSession(slot.time) : null;
}

/* ------------------------- calendar-week date helpers ------------------------- */
/** Local-time YYYY-MM-DD (toISOString would shift the date across UTC midnight). */
export function isoDateLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The Monday of the week containing `date` (weeks run Mon–Sun like DAYS). */
export function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** { Mon: '2026-07-13', Tue: '2026-07-14', ... } for the week starting at `monday`. */
export function weekDatesFrom(monday) {
  const map = {};
  DAYS.forEach((day, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    map[day] = isoDateLocal(d);
  });
  return map;
}

/** 'YYYY-MM-DD' -> 'Mon'..'Sun'. */
export function weekdayOfDate(iso) {
  return DAYS[(new Date(iso + 'T00:00:00').getDay() + 6) % 7];
}

/* ------------------------------- CSV/ICS ------------------------------- */
export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Builds a real .xlsx file (not CSV) from a header row + array-of-arrays and triggers a
    download — used for the instructor's grade-sheet export. Reuses the same SheetJS build
    (window.XLSX, vendored in index.html) already used to *read* Excel imports elsewhere. */
export function exportRowsToXlsx(filename, header, rows, sheetName = 'Sheet1') {
  const ws = window.XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
  window.XLSX.writeFile(wb, filename);
}

/** Minimal RFC4180-style CSV parser: handles quoted fields, escaped quotes, and CRLF/LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function icsEscape(v) {
  return String(v ?? '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
}

/** Next calendar date (YYYYMMDD) that falls on the given day-of-week, starting from today. */
export function nextDateForDay(dayAbbrev) {
  const dayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[dayAbbrev];
  const d = new Date();
  const diff = (dayIndex - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/* ------------------------- account bulk-import parsing ------------------------- */
/** Header-flexible CSV array-of-arrays -> account row objects. */
export function csvArrayRowsToAccountObjects(rows) {
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    name: header.findIndex(h => h === 'name' || h === 'full name'),
    email: header.indexOf('email'),
    role: header.findIndex(h => h === 'role' || h === 'type'),
    department: header.findIndex(h => h.startsWith('dep')),
  };
  return rows.slice(1).filter(r => r.some(c => c.trim() !== '')).map(r => ({
    name: idx.name > -1 ? (r[idx.name] || '').trim() : '',
    email: idx.email > -1 ? (r[idx.email] || '').trim() : '',
    role: idx.role > -1 ? (r[idx.role] || '').trim() : '',
    department: idx.department > -1 ? (r[idx.department] || '').trim() : '',
  }));
}

/** Header-flexible Excel row objects (arbitrary casing) -> account row objects. */
export function excelObjectRowsToAccountObjects(rows) {
  return rows.map(r => {
    const keys = Object.keys(r);
    const find = (...names) => {
      const k = keys.find(k => names.includes(k.trim().toLowerCase()));
      return k ? String(r[k]).trim() : '';
    };
    return { name: find('name', 'full name'), email: find('email'), role: find('role', 'type'), department: find('department', 'dept') };
  }).filter(r => r.name || r.email);
}

export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        resolve(window.XLSX.utils.sheet_to_json(sheet, { defval: '' }));
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}

/* ---------------------------- entity lookup helpers ---------------------------- */
export function departmentById(departments, id) { return departments.find(d => d.id === id); }
export function departmentName(departments, id) { const d = departmentById(departments, id); return d ? d.name : '—'; }
export function teacherById(teachers, id) { return teachers.find(t => t.id === id); }
export function teacherName(teachers, id) { const t = teacherById(teachers, id); return t ? t.name : '—'; }
export function roomById(rooms, id) { return rooms.find(r => r.id === id); }
export function roomName(rooms, id) { const r = roomById(rooms, id); return r ? r.name : '—'; }
export function termById(terms, id) { return terms.find(t => t.id === id); }
export function termName(terms, id) { const t = termById(terms, id); return t ? t.name : '—'; }
export function courseById(courses, id) { return courses.find(c => c.id === id); }

/* ---------------------------- roster / status helpers ---------------------------- */
export function enrolledCount(courseRosters, courseId) {
  const roster = courseRosters.get(courseId);
  return roster ? roster.filter(r => r.status === 'enrolled').length : 0;
}
export function waitlistCount(courseRosters, courseId) {
  const roster = courseRosters.get(courseId);
  return roster ? roster.filter(r => r.status === 'waitlisted').length : 0;
}

// Keys map to academics.json's examForm.types.* and the .exam-type-{key} CSS classes.
export const EXAM_TYPES = ['quiz', 'midterm', 'final'];

/** `key` maps to common.json's `status.*` keys — callers translate via t(`common:status.${key}`)
    rather than displaying `label` directly, so this stays language-agnostic. */
export function examStatus(exam, conflictsData) {
  if (!exam.date) return { key: 'unscheduled', label: 'Unscheduled', cls: 'pill-amber' };
  const overCap = conflictsData.warnings.some(w => w.type === 'capacity' && w.examId === exam.id);
  if (overCap) return { key: 'overCapacity', label: 'Over capacity', cls: 'pill-red' };
  const clash = conflictsData.warnings.some(w => w.type === 'exam-clash' && w.examIds.includes(exam.id));
  if (clash) return { key: 'clash', label: 'Clash', cls: 'pill-amber' };
  return { key: 'confirmed', label: 'Confirmed', cls: 'pill-green' };
}

export function roomStatus(rooms, exams, conflictsData, roomId) {
  if (conflictsData.critical.some(c => c.roomId === roomId)) return { key: 'conflict', label: 'Conflict', cls: 'pill-red' };
  if (conflictsData.warnings.some(w => w.type === 'capacity' && exams.find(e => e.id === w.examId && e.roomId === roomId))) {
    return { key: 'partial', label: 'Partial', cls: 'pill-amber' };
  }
  return { key: 'available', label: 'Available', cls: 'pill-green' };
}
