import { Link, useLocation } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { UI_LANGUAGES } from './i18n';
import { useTheme } from './components/ThemeContext';
import { getCurrentGame, setCurrentGame } from './langDefaults';
import { useContentLangs } from './hooks/useContentLangs';
import nav from './App.module.scss';

type NavLinkDescriptor = {
  to: string;
  labelKey: string;
  exact: boolean;
};

const NAV_LINKS: NavLinkDescriptor[] = [
  { to: '/', labelKey: 'nav.home', exact: true },
  { to: '/glossary', labelKey: 'nav.glossary', exact: false },
  { to: '/diff', labelKey: 'nav.diff', exact: false },
  { to: '/coherence', labelKey: 'nav.coherence', exact: false },
];

export const AppNav = () => {
  const loc = useLocation();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { srcLang, targetLang } = useContentLangs();

  const routeGameId = useMemo(() => {
    const match = loc.pathname.match(/^\/games\/([^/]+)/);
    return match?.[1] ?? null;
  }, [loc.pathname]);

  const currentGameId = routeGameId ?? getCurrentGame();

  const { data: games } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: 60_000,
  });

  const currentGame = games?.find((game) => game.id === currentGameId) ?? null;

  useEffect(() => {
    if (routeGameId) setCurrentGame(routeGameId);
  }, [routeGameId]);

  return (
    <nav className={nav.nav}>
      <Link to="/" className={nav.brand}>
        {t('nav.brand')}
      </Link>
      {NAV_LINKS.map(({ to, labelKey, exact }) => {
        const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
        return (
          <Link key={to} to={to} className={active ? nav.activeLink : nav.link}>
            {t(labelKey)}
          </Link>
        );
      })}

      <div className={nav.contextStrip}>
        <Link
          to={currentGame ? `/games/${currentGame.id}` : '/games'}
          className={nav.contextBadge}
          title={
            currentGame ? t('nav.currentGameLink', { game: currentGame.name }) : t('nav.pickGame')
          }
        >
          <span className={nav.contextLabel}>{t('nav.currentGame')}</span>
          <span className={nav.contextValue}>{currentGame?.name ?? t('nav.noGameSelected')}</span>
        </Link>
        <Link to="/settings" className={nav.contextBadge} title={t('nav.contentLanguageLink')}>
          <span className={nav.contextLabel}>{t('nav.contentLang')}</span>
          <span className={nav.contextValue}>
            {srcLang.toUpperCase()} → {targetLang.toUpperCase()}
          </span>
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
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </select>
    </nav>
  );
};
