import { useTranslation } from 'react-i18next';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { canAccessSection } from '../permissions.js';

/** Port of the `.section` / `.section.active` class-toggling in showSection() — every page stays
    mounted at all times (matching the original always-in-DOM sections) so per-page state (search
    box text, filters, tab selection) survives navigating away and back.

    Also the single defense-in-depth checkpoint every page renders through: NavigationContext
    already stops `showSection`/`?section=` from landing on a section the current role can't
    reach, but this is the layer-2 (page/route) backstop in case that's ever bypassed (a stray
    `history.pushState`, a future caller that skips showSection) — it blocks the real content from
    rendering rather than trusting the caller. */
export default function Section({ name, children }) {
  const { t } = useTranslation('common');
  const { activeSection } = useNavigation();
  const { currentUser } = useAppData();
  const isActive = activeSection === name;
  if (isActive && currentUser && !canAccessSection(currentUser.role, name)) {
    return (
      <div className="section active">
        <div id="content"><div className="field-hint" style={{ padding: 14 }}>{t('accessDenied')}</div></div>
      </div>
    );
  }
  return <div className={'section' + (isActive ? ' active' : '')}>{children}</div>;
}
