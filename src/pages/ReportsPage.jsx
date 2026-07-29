import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line,
} from 'recharts';
import { Trans, useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../api.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_COLORS = ['#4B7FE8', '#1B9E5A', '#E8A84B', '#7F77DD', '#D85A30', '#2FA9B0', '#8A93AA'];

function ChartPanel({ title, subtitle, children, empty }) {
  return (
    <div className="panel chart-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-subtitle">{subtitle}</div>
        </div>
      </div>
      {empty ? <div className="field-hint" style={{ padding: 14 }}>{empty}</div> : (
        <ResponsiveContainer width="100%" height={280}>
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Admin-only analytics: room utilization, course popularity, teacher workload (all scoped to
    the currently selected term, same as every other admin page), and enrollment trends across
    every term (deliberately term-independent — that's the whole point of a trend). */
export default function ReportsPage() {
  const { t } = useTranslation(['dashboard', 'admissions', 'common']);
  const { activeTermId, terms, currentUser } = useAppData();
  const { activeSection } = useNavigation();
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Recharts has no logical-property support, so swap left/right margins by hand for RTL languages.
  const isRtl = document.documentElement.dir === 'rtl';
  const chartMargin = isRtl ? { top: 8, right: 0, left: 16, bottom: 8 } : { top: 8, right: 16, left: 0, bottom: 8 };

  useEffect(() => {
    // Every page in this app stays mounted at all times regardless of role (see AppShell.jsx) —
    // this page is admin-only, so skip the fetch entirely for anyone else. Without this, every
    // faculty/student login would silently 403 against this admin-only endpoint the moment the
    // app boots, and the resulting error toast would show up in their notification bell.
    if (!activeTermId || currentUser.role !== 'admin') { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    api('GET', `/reports?termId=${activeTermId}`)
      .then(res => { if (!cancelled) setData(res); })
      .catch(err => { if (!cancelled) toast(err.message, 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTermId, currentUser.role]);

  const activeTerm = terms.find(term => term.id === activeTermId);
  const rooms = data?.roomUtilization || [];
  const courses = data?.coursePopularity || [];
  const teachers = (data?.teacherWorkload || []).filter(tw => tw.sections > 0);
  const trends = (data?.enrollmentTrends || []).map(term => ({ ...term, termName: term.termName || t('reports.termFallback', { id: term.termId }) }));
  const applicationStats = data?.applicationStats || { total: 0, accepted: 0, rejected: 0, pending: 0, acceptanceRate: null };

  const mostPopular = courses.slice().sort((a, b) => b.enrolledCount - a.enrolledCount).slice(0, 8);
  const leastPopular = courses.slice().sort((a, b) => a.enrolledCount - b.enrolledCount).slice(0, 8);

  return (
    <Section name="reports">
      <div className="topbar">
        <i className="ti ti-chart-bar" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('reports.title')}</h2>
      </div>
      <div id="content">
        {!activeTermId && <div className="field-hint" style={{ padding: 14 }}>{t('reports.noTermSelected')}</div>}
        {activeTermId && activeSection === 'reports' && (
          <>
            <div className="panel-subtitle" style={{ marginBottom: 10 }}>
              <Trans
                i18nKey="dashboard:reports.scopeNotice"
                values={{ term: activeTerm?.name || t('reports.currentTermFallback') }}
                components={{ strong: <strong /> }}
              />
            </div>

            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">{t('admissions:reports.panelTitle')}</div>
                  <div className="panel-subtitle">{t('admissions:reports.panelSubtitle')}</div>
                </div>
              </div>
              <div className="stat-grid" style={{ marginBottom: 0 }}>
                <div className="stat-card stat-accent-blue">
                  <div className="s-icon s-blue"><i className="ti ti-clipboard-list"></i></div>
                  <div className="stat-label">{t('admissions:reports.total')}</div>
                  <div className="stat-value">{applicationStats.total}</div>
                </div>
                <div className="stat-card stat-accent-green">
                  <div className="s-icon s-green"><i className="ti ti-check"></i></div>
                  <div className="stat-label">{t('admissions:reports.accepted')}</div>
                  <div className="stat-value">{applicationStats.accepted}</div>
                </div>
                <div className="stat-card stat-accent-red">
                  <div className="s-icon s-red"><i className="ti ti-x"></i></div>
                  <div className="stat-label">{t('admissions:reports.rejected')}</div>
                  <div className="stat-value">{applicationStats.rejected}</div>
                </div>
                <div className="stat-card stat-accent-gold">
                  <div className="s-icon s-gold"><i className="ti ti-clock"></i></div>
                  <div className="stat-label">{t('admissions:reports.pending')}</div>
                  <div className="stat-value">{applicationStats.pending}</div>
                </div>
                <div className="stat-card stat-accent-purple">
                  <div className="s-icon s-purple"><i className="ti ti-percentage"></i></div>
                  <div className="stat-label">{t('admissions:reports.acceptanceRate')}</div>
                  <div className="stat-value">{applicationStats.acceptanceRate != null ? `${applicationStats.acceptanceRate}%` : t('admissions:reports.notAvailable')}</div>
                </div>
              </div>
            </div>

            <ChartPanel
              title={t('reports.chartTitles.roomUtilization')}
              subtitle={t('reports.chartSubtitles.roomUtilization')}
              empty={!loading && rooms.length === 0 ? t('reports.empty.rooms') : null}
            >
              <BarChart data={rooms} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: t('reports.axis.hoursPerWeek'), angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <Tooltip formatter={(v) => t('reports.tooltip.hours', { count: v })} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {DAYS.map((d, i) => (
                  <Bar key={d} dataKey={`byDay.${d}`} name={t('common:days.' + d)} stackId="hours" fill={DAY_COLORS[i]} />
                ))}
              </BarChart>
            </ChartPanel>

            <div className="panel-row">
              <ChartPanel
                title={t('reports.chartTitles.mostPopular')}
                subtitle={t('reports.chartSubtitles.byEnrollment')}
                empty={!loading && mostPopular.length === 0 ? t('reports.empty.courses') : null}
              >
                <BarChart data={mostPopular} layout="vertical" margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="code" width={70} tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(_, p) => p?.[0]?.payload?.name || ''} />
                  <Bar dataKey="enrolledCount" name={t('reports.legend.enrolled')} fill="#1B9E5A" />
                </BarChart>
              </ChartPanel>

              <ChartPanel
                title={t('reports.chartTitles.leastPopular')}
                subtitle={t('reports.chartSubtitles.byEnrollment')}
                empty={!loading && leastPopular.length === 0 ? t('reports.empty.courses') : null}
              >
                <BarChart data={leastPopular} layout="vertical" margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="code" width={70} tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(_, p) => p?.[0]?.payload?.name || ''} />
                  <Bar dataKey="enrolledCount" name={t('reports.legend.enrolled')} fill="#D85A30" />
                </BarChart>
              </ChartPanel>
            </div>

            <ChartPanel
              title={t('reports.chartTitles.teacherWorkload')}
              subtitle={t('reports.chartSubtitles.teacherWorkload')}
              empty={!loading && teachers.length === 0 ? t('reports.empty.teachers') : null}
            >
              <BarChart data={teachers} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis yAxisId="hours" tick={{ fontSize: 11 }} label={{ value: t('reports.axis.hoursPerWeek'), angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <YAxis yAxisId="sections" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} label={{ value: t('reports.axis.sections'), angle: 90, position: 'insideRight', fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="hours" dataKey="weeklyHours" name={t('reports.legend.weeklyHours')} fill="#4B7FE8" />
                <Bar yAxisId="sections" dataKey="sections" name={t('reports.legend.sections')} fill="#E8A84B" />
              </BarChart>
            </ChartPanel>

            <ChartPanel
              title={t('reports.chartTitles.enrollmentTrends')}
              subtitle={t('reports.chartSubtitles.enrollmentTrends')}
              empty={!loading && trends.length === 0 ? t('reports.empty.terms') : null}
            >
              <LineChart data={trends} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="termName" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="totalEnrolled" name={t('reports.legend.enrolledStudents')} stroke="#7F77DD" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartPanel>
          </>
        )}
      </div>
    </Section>
  );
}
