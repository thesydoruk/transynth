import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES } from './i18n';
import { useAuth } from './components/AuthContext';
import { useTheme } from './components/ThemeContext';
import nav from './App.module.scss';

type NavLinkDescriptor = {
  to: string;
  labelKey: string;
  exact: boolean;
  multiUserOnly?: boolean;
};

/**
 * Navigation link descriptors — label keys reference the nav.* i18n namespace.
 *
 * Removed from nav (now live inside Settings tabs or the home Overview page):
 *   /dashboard, /ops    — merged into / (HomePage)
 *   /qa-rules           — Settings → QA Rules tab
 *   /tradauto           — Settings → TradAuto tab
 *   /tmx                — Settings → TMX tab
 *   /activity           — Settings → Activity tab
 *
 * The home page (/) is accessible only via the brand "FO4 Localizer" click.
 */
const NAV_LINKS: NavLinkDescriptor[] = [
  { to: '/glossary', labelKey: 'nav.glossary', exact: false },
  { to: '/diff', labelKey: 'nav.diff', exact: false },
  { to: '/coherence', labelKey: 'nav.coherence', exact: false },
  { to: '/review-queue', labelKey: 'nav.reviewQueue', exact: false },
  { to: '/users', labelKey: 'nav.users', exact: false, multiUserOnly: true },
];

/**
 * Navigation bar — renders links, user info, and language switcher.
 * In multi-user mode, shows the current user's name and a logout button.
 */
export const AppNav = () => {
  const loc = useLocation();
  const { user, multiUser, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className={nav.nav}>
      <Link to="/" className={nav.brand}>{t('nav.brand')}</Link>
      {NAV_LINKS
        .filter((link) => !link.multiUserOnly || multiUser)
        .map(({ to, labelKey, exact }) => {
          const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
          return (
            <Link key={to} to={to} className={active ? nav.activeLink : nav.link}>
              {t(labelKey)}
            </Link>
          );
        })}

      <span className={nav.spacer} />

      <button
        className={nav.themeBtn}
        onClick={toggleTheme}
        title={t(theme === 'dark' ? 'nav.themeLight' : 'nav.themeDark')}
      >
        {theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
      </button>

      <Link
        to="/settings"
        className={nav.iconBtn}
        title={t('nav.settings')}
        aria-label={t('nav.settings')}
      >
        {'\u2699\uFE0F'}
      </Link>

      <select
        className={nav.langSwitch}
        value={i18n.language}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
      >
        {UI_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>{language.label}</option>
        ))}
      </select>

      {user && (
        <span className={nav.userInfo}>
          {user.display_name}
          {multiUser && user.role !== 'translator' && (
            <span className={nav.roleBadge}>{user.role}</span>
          )}
        </span>
      )}
      {multiUser && user && (
        <button onClick={logout} className={nav.logoutBtn}>{t('nav.logout')}</button>
      )}
    </nav>
  );
};