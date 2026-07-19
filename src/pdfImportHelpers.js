import { DAYS } from './utils.js';

export const PDF_IMPORT_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PDF_IMPORT_PLACEHOLDER_TEACHER_RE = /^new\s+teacher$/i;

export function isPlaceholderTeacherName(name) { return PDF_IMPORT_PLACEHOLDER_TEACHER_RE.test((name || '').trim()); }

/** Mirrors the server's own row validation so invalid rows are visibly flagged before Confirm is even clicked. */
export function pdfImportRowError(row) {
  if (!row.courseName || !row.courseName.trim()) return 'Course name is required.';
  if (!row.day || !DAYS.includes(row.day)) return 'Day is invalid.';
  if (!PDF_IMPORT_TIME_RE.test(row.startTime || '')) return 'Start time must be HH:MM.';
  if (!PDF_IMPORT_TIME_RE.test(row.endTime || '')) return 'End time must be HH:MM.';
  if (PDF_IMPORT_TIME_RE.test(row.startTime) && PDF_IMPORT_TIME_RE.test(row.endTime) && row.endTime <= row.startTime) {
    return 'End time must be after start time.';
  }
  const sem = Number(row.programSemester);
  if (!Number.isInteger(sem) || sem < 1 || sem > 8) return 'Semester must be 1-8.';
  if (!row.section || !String(row.section).trim()) return 'Section is required.';
  if (!row.teacher || !row.teacher.trim()) return 'Missing teacher — fill in or leave blank to import as-is.';
  if (isPlaceholderTeacherName(row.teacher)) return '"New Teacher" is a placeholder — assign a real teacher, or confirm as-is and fix it later.';
  if (!row.room || !row.room.trim()) return 'Missing room — fill in or leave blank to import as-is.';
  return null;
}

/** "Dr. Jamshid Kazimi" -> "jamshid.kazimi" — mirrors the server's email-generation scheme, for
    preview only (the server does the authoritative, collision-checked generation at confirm time). */
export function pdfImportEmailLocalPart(name) {
  const cleaned = name.replace(/^(dr|mr|mrs|ms|prof|eng)\.?\s+/i, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean).map(p => p.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
  if (!parts.length) return 'teacher';
  return parts.length === 1 ? parts[0] : `${parts[0]}.${parts[parts.length - 1]}`;
}

export function pdfImportGroupKey(row) { return `${row.programSemester ?? '—'}|${row.section ?? '—'}`; }

/** Unique lecturer names in the current preview, classified against the already-loaded
    teachers/users so the admin can see up front which ones are brand new (a login will be
    created) vs already known. */
export function pdfImportLecturerSummary(rows, teachers, allUsers) {
  const names = [...new Set(rows.map(r => (r.teacher || '').trim()).filter(Boolean))].sort();
  return names.map(name => {
    if (isPlaceholderTeacherName(name)) return { name, status: 'placeholder' };
    const existingTeacher = teachers.find(t => t.name.trim().toLowerCase() === name.toLowerCase());
    if (existingTeacher && existingTeacher.userId) {
      const user = allUsers.find(u => u.id === existingTeacher.userId);
      return { name, status: 'matched', email: user ? user.email : null };
    }
    if (existingTeacher) return { name, status: 'matched-no-login' };
    return { name, status: 'new' };
  });
}
