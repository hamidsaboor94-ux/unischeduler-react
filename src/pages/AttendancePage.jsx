import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTableSort } from '../hooks/useTableSort.jsx';
import { fetchCourseAttendance, fetchCourseRoster, submitAttendance } from '../api.js';
import { fmtDate, fmt12Hour } from '../utils.js';

const STATUSES = ['present', 'absent', 'late'];
const STATUS_PILL = { present: 'pill-green', absent: 'pill-red', late: 'pill-amber' };

/** Admin/faculty attendance: take attendance for one session (course + slot + date) and
    review the course's full history. Faculty only see their own courses (courses[] is
    already scoped server-side, same as the Courses page); admin sees every course. */
export default function AttendancePage() {
  const { t } = useTranslation(['academics', 'common']);
  const { courses, slots, currentUser } = useAppData();
  const { sectionFocus } = useNavigation();
  const { toast } = useToast();
  const canView = currentUser.role === 'admin' || currentUser.role === 'faculty';

  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [slotId, setSlotId] = useState('');
  const [date, setDate] = useState('');
  const [statuses, setStatuses] = useState({}); // studentId -> 'present' | 'absent' | 'late'
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [roster, setRoster] = useState([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyStudentFilter, setHistoryStudentFilter] = useState('');

  useEffect(() => {
    if (!courses.some(c => c.id === Number(courseId))) setCourseId(courses[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses]);

  // A course quick action ("Take Attendance") lands here with a course to preselect.
  useEffect(() => {
    if (sectionFocus?.section === 'attendance' && sectionFocus.courseId != null && courses.some(c => c.id === sectionFocus.courseId)) {
      setCourseId(sectionFocus.courseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionFocus]);

  const courseSlots = slots.filter(s => s.courseId === Number(courseId));
  const enrolledStudents = roster.filter(r => r.status === 'enrolled');

  useEffect(() => {
    if (!courseSlots.length) { setSlotId(''); return; }
    if (!courseSlots.some(s => String(s.id) === slotId)) setSlotId(String(courseSlots[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, slots]);

  async function loadHistory() {
    // Every page in this app stays mounted at all times regardless of role (see AppShell.jsx) —
    // this page is admin/faculty only, so skip the fetch entirely for anyone else. Without this,
    // a student's very first courseId (courses[0] — the full catalog for a student, unlike the
    // pre-scoped list faculty get) would silently 403 against this admin/faculty-only endpoint
    // the moment the app boots, and the resulting error toast would show up in their notification bell.
    if (!courseId || !canView) { setHistory([]); return; }
    setLoadingHistory(true);
    try {
      setHistory(await fetchCourseAttendance(courseId));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoadingHistory(false);
    }
  }
  useEffect(() => { loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [courseId]);

  // Fetched fresh per course (rather than reused from the app-wide roster snapshot taken at
  // login) so enrollments made elsewhere while this session has been open — by an admin, or
  // by this same faculty member in the Enrollment page — are always reflected here.
  async function loadRoster() {
    if (!courseId || !canView) { setRoster([]); return; }
    setLoadingRoster(true);
    try {
      setRoster(await fetchCourseRoster(courseId));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoadingRoster(false);
    }
  }
  useEffect(() => { loadRoster(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [courseId]);

  // Opening a date defaults everyone to Present (the common case — a teacher only has to
  // click to flag exceptions) but re-opening a date already submitted shows what was
  // actually recorded, so correcting a past session doesn't silently reset it.
  useEffect(() => {
    if (!date || !slotId) { setStatuses({}); return; }
    const map = {};
    enrolledStudents.forEach(r => { map[r.studentId] = 'present'; });
    history.filter(h => h.slotId === Number(slotId) && h.date === date).forEach(h => { map[h.studentId] = h.status; });
    setStatuses(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, slotId, history, courseId, roster]);

  async function handleSubmit() {
    if (!date) { toast(t('academics:attendancePage.toasts.pickDate'), 'warning'); return; }
    if (!slotId) { toast(t('academics:attendancePage.toasts.noSlot'), 'warning'); return; }
    if (!enrolledStudents.length) { toast(t('academics:attendancePage.toasts.noStudents'), 'warning'); return; }
    setSaving(true);
    try {
      await submitAttendance({
        slotId: Number(slotId), date,
        entries: enrolledStudents.map(r => ({ studentId: r.studentId, status: statuses[r.studentId] || 'present' })),
      });
      toast(t('academics:attendancePage.toasts.saved'));
      await loadHistory();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const filteredHistory = historyStudentFilter
    ? history.filter(h => h.studentName.toLowerCase().includes(historyStudentFilter.toLowerCase()))
    : history;
  const { sorted, sortTh, sortArrow } = useTableSort('attendance-history', filteredHistory, {
    date: h => h.date, student: h => h.studentName, status: h => h.status,
  });

  return (
    <Section name="attendance">
      <div className="topbar">
        <i className="ti ti-clipboard-check" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('academics:attendancePage.title')}</h2>
        <div className="topbar-actions">
          <select className="select-sm" aria-label={t('academics:attendancePage.courseAria')} value={courseId} onChange={e => setCourseId(e.target.value)}>
            {courses.length ? courses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>) : <option value="">{t('academics:attendancePage.noCoursesYet')}</option>}
          </select>
        </div>
      </div>
      <div id="content">
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">{t('academics:attendancePage.takeAttendance')}</div>
              <div className="panel-subtitle">{t('academics:attendancePage.takeAttendanceHint')}</div>
            </div>
          </div>
          <div className="form-row-2">
            <div className="form-row">
              <div className="form-label">{t('academics:attendancePage.sessionDate')}</div>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            {courseSlots.length > 1 && (
              <div className="form-row">
                <div className="form-label">{t('academics:attendancePage.session')}</div>
                <select value={slotId} onChange={e => setSlotId(e.target.value)}>
                  {courseSlots.map(s => <option key={s.id} value={s.id}>{t('common:days.' + s.day)} {fmt12Hour(s.time)}</option>)}
                </select>
              </div>
            )}
          </div>

          {!courseSlots.length && <div className="field-hint">{t('academics:attendancePage.noSlotHint')}</div>}

          {date && courseSlots.length > 0 && (
            loadingRoster ? <div className="field-hint">{t('academics:attendancePage.loading')}</div> :
            enrolledStudents.length ? (
              <>
                <table className="data-table">
                  <thead><tr><th>{t('academics:attendancePage.table.student')}</th><th>{t('academics:attendancePage.table.status')}</th></tr></thead>
                  <tbody>
                    {enrolledStudents.map(r => (
                      <tr key={r.studentId}>
                        <td>{r.name}</td>
                        <td>
                          <div className="attendance-status-group">
                            {STATUSES.map(s => (
                              <button
                                key={s} type="button"
                                className={'attendance-status-btn ' + s + (statuses[r.studentId] === s ? ' active' : '')}
                                onClick={() => setStatuses(prev => ({ ...prev, [r.studentId]: s }))}
                              >
                                {t(`academics:attendanceStatus.${s}`)}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className={'btn-primary' + (saving ? ' btn-loading' : '')} style={{ marginTop: 12 }} disabled={saving} onClick={handleSubmit}>
                  {saving ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('academics:attendancePage.saveAttendance')}</>}
                </button>
              </>
            ) : <div className="field-hint">{t('academics:attendancePage.noStudentsEnrolled')}</div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">{t('academics:attendancePage.historyTitle')}</div>
            <input
              type="text" className="select-sm" aria-label={t('academics:attendancePage.filterAria')}
              placeholder={t('academics:attendancePage.filterPlaceholder')} value={historyStudentFilter}
              onChange={e => setHistoryStudentFilter(e.target.value)}
            />
          </div>
          <table className="data-table">
            <thead><tr>
              <th {...sortTh('date')}>{t('academics:attendancePage.historyTable.date')}{sortArrow('date')}</th>
              <th {...sortTh('student')}>{t('academics:attendancePage.historyTable.student')}{sortArrow('student')}</th>
              <th {...sortTh('status')}>{t('academics:attendancePage.historyTable.status')}{sortArrow('status')}</th>
            </tr></thead>
            <tbody>
              {loadingHistory ? (
                <tr><td colSpan={3} className="field-hint" style={{ padding: 14 }}>{t('academics:attendancePage.loading')}</td></tr>
              ) : sorted.length ? sorted.map(h => (
                <tr key={h.id}>
                  <td>{fmtDate(h.date)}</td>
                  <td>{h.studentName}</td>
                  <td><span className={'pill ' + STATUS_PILL[h.status]}>{t(`academics:attendanceStatus.${h.status}`)}</span></td>
                </tr>
              )) : (
                <tr><td colSpan={3} className="field-hint" style={{ padding: 14 }}>{t('academics:attendancePage.noHistory')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
