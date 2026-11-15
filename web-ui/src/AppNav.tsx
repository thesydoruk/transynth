import { Link, useLocation, useMatch } from 'react-router-dom';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { UI_LANGUAGES } from './i18n';
import { NavIcon } from './components/NavIcon';
import { useTheme } from './components/ThemeContext';
import { getCurrentGame, setCurrentGame } from './langDefaults';
import { useContentLangs } from './hooks/useContentLangs';
import { routePatterns, routes } from './routes';
import nav from './App.module.scss';

export const AppNav = () => {
  const loc = useLocation();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { srcLang, targetLang } = useContentLangs();

  const routeGameId = useMatch(`${routePatterns.game}/*`)?.params.gameId ?? null;

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
      <Link to={routes.games()} className={nav.brand}>
        {t('nav.brand')}
      </Link>

      <div className={nav.contextStrip}>
        <Link
          to={currentGame ? routes.game(currentGame.id) : routes.games()}
          className={nav.contextBadge}
          title={
            currentGame ? t('nav.currentGameLink', { game: currentGame.name }) : t('nav.pickGame')
          }
          aria-label={
            currentGame ? t('nav.currentGameLink', { game: currentGame.name }) : t('nav.pickGame')
          }
        >
          <span className={nav.contextLabel}>{t('nav.currentGame')}</span>
          <span className={nav.contextValue}>{currentGame?.name ?? t('nav.noGameSelected')}</span>
        </Link>
        <span className={nav.contextPlain} title={t('nav.contentLangHint')}>
          <span className={nav.contextLabel}>{t('nav.contentLang')}</span>
          <span className={nav.contextValue}>
            {srcLang.toUpperCase()} → {targetLang.toUpperCase()}
          </span>
        </span>
      </div>

      <span className={nav.spacer} />

      <button
        type="button"
        className={nav.themeBtn}
        onClick={toggleTheme}
        title={t(theme === 'dark' ? 'nav.themeLight' : 'nav.themeDark')}
        aria-label={t(theme === 'dark' ? 'nav.themeLight' : 'nav.themeDark')}
      >
        <NavIcon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>

      <Link
        to="/system-log"
        className={loc.pathname === '/system-log' ? nav.iconBtnActive : nav.iconBtn}
        title={t('nav.systemLog')}
        aria-label={t('nav.systemLog')}
      >
        <NavIcon name="log" />
      </Link>

      <Link
        to="/settings"
        className={loc.pathname === '/settings' ? nav.iconBtnActive : nav.iconBtn}
        title={t('nav.settings')}
        aria-label={t('nav.settings')}
      >
        <NavIcon name="settings" />
      </Link>

      <select
        className={nav.langSwitch}
        value={i18n.language}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        aria-label={t('nav.uiLang')}
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
