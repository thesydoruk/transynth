/**
 * GameLayout — the frame every section of a game shares: a crumb back to the game list,
 * the game's name and the section tabs. The section itself renders below.
 *
 * Route: /games/:gameId/*
 */
import { Link, Outlet, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGameInfo } from '../../hooks/useGameInfo';
import { routes } from '../../routes';
import { GameTabs } from './GameTabs';
import { GameUnavailable } from './GameUnavailable';
import s from './GameLayout.module.scss';

export const GameLayout = () => {
  const { t } = useTranslation();
  const { gameId = '' } = useParams<{ gameId: string }>();
  const { game, isLoading, error } = useGameInfo(gameId);

  if (isLoading) return <GameUnavailable state="loading" />;
  if (error) return <GameUnavailable state="error" error={error} />;
  if (!game) return <GameUnavailable state="missing" />;

  return (
    <>
      <div className={s.bar}>
        <nav className={s.crumbs} aria-label={t('gamePage.crumbsLabel')}>
          <Link to={routes.games()} className={s.crumb}>
            {t('gamePage.crumbGames')}
          </Link>
          <span className={s.crumbSep} aria-hidden="true">
            /
          </span>
          <Link to={routes.game(gameId)} className={s.crumbGame}>
            {game.name}
          </Link>
        </nav>
        <GameTabs gameId={gameId} />
      </div>
      <Outlet />
    </>
  );
};
