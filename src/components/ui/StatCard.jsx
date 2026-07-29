/** Shared "icon chip + delta" KPI tile for dashboard/summary stat rows (Exams, Conflicts,
 *  Finance, Enrollment, etc). Deliberately separate from Card.jsx's `StatCard` — that one is
 *  the gradient-wash/left-accent-border content-card skin also used by exam/course cards;
 *  this is a flatter, denser tile meant only for top-of-page KPI rows. Reuses whatever
 *  `.stat-grid` layout the page already has — only the tile markup/styling changes.
 *
 *  `delta` is optional ({ label, tone }) and must only ever be built by the caller from values
 *  it already has (a real percentage, a real previous-period comparison, or a status derived
 *  from existing numbers) — this component never invents one. Omit it and no pill renders. */
const HUES = ['teal', 'amber', 'indigo', 'red'];

export function StatCard({ icon, hue = 'indigo', label, value, sub, delta, children, className = '' }) {
  const cls = ['kpi-card', className].filter(Boolean).join(' ');
  const chipHue = HUES.includes(hue) ? hue : 'indigo';
  return (
    <div className={cls}>
      <div className="kpi-card-top">
        <div className={`kpi-chip kpi-chip--${chipHue}`}>
          {icon && <i className={`ti ${icon}`} aria-hidden="true"></i>}
        </div>
        {delta && <div className={`kpi-pill kpi-pill--${delta.tone || 'neutral'}`}>{delta.label}</div>}
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {children}
    </div>
  );
}
