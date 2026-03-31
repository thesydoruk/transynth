import { Link, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { UI_LANGUAGES } from './i18n';
import { useAuth } from './components/AuthContext';
import { useTheme } from './components/ThemeContext';
import { getCurrentGame, getSrcLang, getTgtLang, setCurrentGame } from './langDefaults';
import nav from './App.module.scss';

type NavLinkDescriptor = {
  to: string;
  labelKey: string;
  exact: boolean;
  /** When true, hides the link unless `multiUser` mode is enabled. */
  multiUserOnly?: boolean;
  /** When true, hides the link unless the current user has the 'admin' role. */
  adminOnly?: boolean;
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
 */
const NAV_LINKS: NavLinkDescriptor[] = [
  { to: '/', labelKey: 'nav.home', exact: true },
  { to: '/glossary', labelKey: 'nav.glossary', exact: false },
  { to: '/diff', labelKey: 'nav.diff', exact: false },
  { to: '/coherence', labelKey: 'nav.coherence', exact: false },
  { to: '/review-queue', labelKey: 'nav.reviewQueue', exact: false },
  { to: '/users', labelKey: 'nav.users', exact: false, multiUserOnly: true, adminOnly: true },
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
  const [contentLangs, setContentLangs] = useState(() => ({ src: getSrcLang(), tgt: getTgtLang() }));

  const routeGameId = useMemo(() => {
    const match = loc.pathname.match(/^\/games\/([^/]+)/);
    return match?.[1] ?? null;
  }, [loc.pathname]);

  const currentGameId = routeGameId ?? getCurrentGame();

  const { data: games } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const currentGame = games?.find((game) => game.id === currentGameId) ?? null;
  const roleShortcut = multiUser && user
    ? user.role === 'reviewer'
      ? {
        to: '/review-queue',
        label: t('nav.focus'),
        value: t('nav.reviewQueue'),
        title: t('nav.reviewerWorkspaceLink'),
      }
      : user.role === 'admin'
        ? {
          to: '/settings?tab=users',
          label: t('nav.admin'),
          value: t('nav.users'),
          title: t('nav.adminWorkspaceLink'),
        }
        : null
    : null;

  useEffect(() => {
    if (routeGameId) setCurrentGame(routeGameId);
  }, [routeGameId]);

  useEffect(() => {
    const syncContentLangs = () => {
      setContentLangs({ src: getSrcLang(), tgt: getTgtLang() });
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === 'fo4-src-lang' || event.key === 'fo4-tgt-lang') {
        syncContentLangs();
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('content-language-change', syncContentLangs);
    window.addEventListener('focus', syncContentLangs);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('content-language-change', syncContentLangs);
      window.removeEventListener('focus', syncContentLangs);
    };
  }, []);

  return (
    <nav className={nav.nav}>
      <Link to="/" className={nav.brand}>{t('nav.brand')}</Link>
      {NAV_LINKS
        .filter((link) => (!link.multiUserOnly || multiUser) && (!link.adminOnly || user?.role === 'admin'))
        .map(({ to, labelKey, exact }) => {
          const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
          return (
            <Link key={to} to={to} className={active ? nav.activeLink : nav.link}>
              {t(labelKey)}
            </Link>
          );
        })}

      <div className={nav.contextStrip}>
        {roleShortcut && (
          <Link to={roleShortcut.to} className={nav.contextBadge} title={roleShortcut.title}>
            <span className={nav.contextLabel}>{roleShortcut.label}</span>
            <span className={nav.contextValue}>{roleShortcut.value}</span>
          </Link>
        )}
        <Link
          to={currentGame ? `/games/${currentGame.id}` : '/games'}
          className={nav.contextBadge}
          title={currentGame ? t('nav.currentGameLink', { game: currentGame.name }) : t('nav.pickGame')}
        >
          <span className={nav.contextLabel}>{t('nav.currentGame')}</span>
          <span className={nav.contextValue}>{currentGame?.name ?? t('nav.noGameSelected')}</span>
        </Link>
        <Link
          to="/settings"
          className={nav.contextBadge}
          title={t('nav.contentLanguageLink')}
        >
          <span className={nav.contextLabel}>{t('nav.contentLang')}</span>
          <span className={nav.contextValue}>{contentLangs.src.toUpperCase()} → {contentLangs.tgt.toUpperCase()}</span>
        </Link>
      </div>

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