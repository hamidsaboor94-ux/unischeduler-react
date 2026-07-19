import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import NotificationBell from './NotificationPanel.jsx';

/** Fixed bottom-right cluster: theme toggle, language switcher, notification bell.
    Rendered once at the app-shell level (not inside Sidebar) so it stays put across every
    page and isn't tied to the sidebar's own scroll/layout. */
export default function UtilityTray() {
  const { t } = useTranslation('common');
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="utility-tray">
      <LanguageSwitcher />
      <button
        className="icon-btn"
        title={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
        aria-label={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
        onClick={toggleTheme}
      >
        <i className={'ti ' + (theme === 'dark' ? 'ti-sun' : 'ti-moon')} aria-hidden="true"></i>
      </button>
      <NotificationBell />
    </div>
  );
}
