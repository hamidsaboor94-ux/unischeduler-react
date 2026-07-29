/** Global reusable card shell — the visual design system extracted from the Timetable's
 *  `.slot` cards (see style.css's `.card`/`.slot` rules). Content-agnostic: callers own
 *  everything inside, this only renders the shell (rounded corners, accent-tinted gradient
 *  wash, left accent border, shadow, optional hover lift) plus a few small composable
 *  building blocks for the common header/icon/footer shapes. */

const ACCENT_TOKENS = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  gold: 'var(--gold)',
  neutral: 'var(--neutral)',
  blue: 'var(--course-blue)',
  teal: 'var(--course-teal)',
  green: 'var(--course-green)',
  lime: 'var(--course-lime)',
  amber: 'var(--course-amber)',
  orange: 'var(--course-orange)',
  rose: 'var(--course-rose)',
  pink: 'var(--course-pink)',
  purple: 'var(--course-purple)',
  indigo: 'var(--course-indigo)',
};

/** Named token (e.g. "success") -> the matching CSS var; anything else (a raw color/gradient,
 *  or already a `var(...)` string) passes through untouched. Omitted accent leaves --card-accent
 *  unset so it falls back to .card's own default (var(--accent)). */
function resolveAccent(accent) {
  if (!accent) return undefined;
  return ACCENT_TOKENS[accent] || accent;
}

/** variant: 'elevated' (default, the .slot look) | 'flat' | 'glass'
 *  size: 'compact' | 'default' | 'large'
 *  clickable: adds hover-lift/shadow/focus-ring styling only — no role/tabIndex/keyboard
 *  handling is added, so it never changes a caller's existing keyboard behavior; pass those
 *  through explicitly if a given usage needs them. */
export function Card({
  as: Tag = 'div',
  accent,
  variant = 'elevated',
  size = 'default',
  clickable = false,
  className = '',
  style,
  children,
  ...rest
}) {
  const resolvedAccent = resolveAccent(accent);
  const cls = [
    'card',
    variant !== 'elevated' ? `card--${variant}` : '',
    size !== 'default' ? `card--${size}` : '',
    clickable ? 'card--clickable' : '',
    className,
  ].filter(Boolean).join(' ');
  const mergedStyle = resolvedAccent ? { '--card-accent': resolvedAccent, ...style } : style;

  return (
    <Tag className={cls} style={mergedStyle} {...rest}>
      {children}
    </Tag>
  );
}

/** Accent-tinted icon swatch. `icon` is a Tabler Icons class suffix (e.g. "ti-school"); pass
 *  `children` instead for a custom icon/image. */
export function CardIcon({ icon, children, className = '' }) {
  return (
    <div className={('card-icon ' + className).trim()}>
      {icon ? <i className={`ti ${icon}`} aria-hidden="true"></i> : children}
    </div>
  );
}

/** Optional horizontal header row: icon + stacked title/subtitle + trailing actions. */
export function CardHeader({ icon, title, subtitle, actions, className = '' }) {
  return (
    <div className={('card-header ' + className).trim()}>
      {icon && <CardIcon icon={icon} />}
      <div className="card-header-text">
        {title && <div className="card-title">{title}</div>}
        {subtitle && <div className="card-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="card-actions">{actions}</div>}
    </div>
  );
}

export function CardContent({ className = '', children }) {
  return <div className={('card-content ' + className).trim()}>{children}</div>;
}

/** Top-border-separated footer row, typically for actions or a trailing meta note. */
export function CardFooter({ className = '', children }) {
  return <div className={('card-footer ' + className).trim()}>{children}</div>;
}

export function CardActions({ className = '', children }) {
  return <div className={('card-actions ' + className).trim()}>{children}</div>;
}
