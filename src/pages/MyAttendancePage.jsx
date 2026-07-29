import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchMyAttendance } from '../api.js';
import { fmtDate } from '../utils.js';

const STATUS_PILL = { present: 'pill-green', absent: 'pill-red', late: 'pill-amber' };

export default function MyAttendancePage() {
  const { t } = useTranslation(['academics', 'common']);
  const { currentUser } = useAppData();
  const { sectionFocus } = useNavigation();
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const panelRefs = useRef(new Map());

  useEffect(() => {
    // Every page in this app stays mounted at all times regardless of role (see AppShell.jsx) —
    // this page is student-only (it's "my" attendance), so skip the fetch entirely for anyone
    // else. Without this, every non-student login would silently 403 against the module-level
    // guard on /attendance/me (only faculty/viewer/student have attendance access), and the
    // resulting error toast would show up in their notification bell.
    if (currentUser.role !== 'student') { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchMyAttendance();
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) toast(err.message, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.role]);

  const byCourse = new Map();
  rows.forEach(r => {
    if (!byCourse.has(r.courseId)) byCourse.set(r.courseId, { courseId: r.courseId, code: r.code, name: r.name, rows: [] });
    byCourse.get(r.courseId).rows.push(r);
  });

  // A course quick action ("Attendance") lands here wanting to jump straight to its panel.
  useEffect(() => {
    if (sectionFocus?.section === 'my-attendance' && sectionFocus.courseId != null) {
      panelRefs.current.get(sectionFocus.courseId)?.scrollIntoView({ block: 'start' });
    }
  }, [sectionFocus, rows]);

  return (
    <Section name="my-attendance">
      <div className="topbar">
        <i className="ti ti-clipboard-check" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('academics:myAttendancePage.title')}</h2>
      </div>
      <div id="content">
        {loading ? (
          <div className="field-hint" style={{ padding: 14 }}>{t('academics:myAttendancePage.loading')}</div>
        ) : byCourse.size ? [...byCourse.values()].map(c => {
          const total = c.rows.length;
          const present = c.rows.filter(r => r.status === 'present').length;
          const late = c.rows.filter(r => r.status === 'late').length;
          const absent = c.rows.filter(r => r.status === 'absent').length;
          const pct = total ? Math.round(((present + late) / total) * 100) : 0;
          return (
            <div className="panel" style={{ marginBottom: 14 }} key={c.code} ref={el => { if (el) panelRefs.current.set(c.courseId, el); }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">{c.code} — {c.name}</div>
                  <div className="panel-subtitle">{t('academics:myAttendancePage.summary', { present, absent, late, pct })}</div>
                </div>
              </div>
              <table className="data-table">
                <thead><tr><th>{t('academics:myAttendancePage.table.date')}</th><th>{t('academics:myAttendancePage.table.status')}</th></tr></thead>
                <tbody>
                  {c.rows.map(r => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.date)}</td>
                      <td><span className={'pill ' + STATUS_PILL[r.status]}>{t(`academics:attendanceStatus.${r.status}`)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }) : (
          <div className="field-hint" style={{ padding: 14 }}>{t('academics:myAttendancePage.empty')}</div>
        )}
      </div>
    </Section>
  );
}
