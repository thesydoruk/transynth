/**
 * GamesPage — supported games catalogue.
 *
 * Displays all games supported by the localization tool as a responsive tile
 * grid.  Each tile shows:
 *   - Cover art (4:3 aspect ratio, loaded from /api/games/cover/:gameId)
 *   - Game name and release year
 *   - Developer
 *   - Engine label
 *   - A badge indicating whether the game uses localized (external .STRINGS)
 *     plugins vs. non-localized (inline UTF-8) plugins
 *
 * Cover images are fetched by the backend from the NexusMods static CDN on
 * the first request and then served from a local disk cache indefinitely.
 * The frontend shows a skeleton placeholder while the image loads.
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { useAuth } from '../../components/AuthContext';
import { GameTile, SkeletonGameTile } from './GameTile';
import s from './GamesPage.module.scss';

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * GamesPage root component.
 *
 * Fetches the static game catalogue from GET /api/games and renders one tile
 * per game.  The list never changes at runtime so we use a very long staleTime.
 */
export const GamesPage = () => {
  const { t } = useTranslation();
  const { multiUser, user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className={s.page}>
        <h1 className={s.title}>{t('games.title')}</h1>
        <div className={s.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonGameTile key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={s.page}>
        <div className={s.error}>{t('common.error', { message: String(error) })}</div>
      </div>
    );
  }

  const emptyHint = multiUser && user
    ? user.role === 'reviewer'
      ? t('games.emptyReviewerHint')
      : user.role === 'admin'
        ? t('games.emptyAdminHint')
        : t('games.emptyTranslatorHint')
    : t('games.emptyTranslatorHint');

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('games.title')}</h1>
      <p className={s.subtitle}>{t('games.subtitle')}</p>
      {(data ?? []).length === 0 ? (
        <div className={s.emptyState}>
          <h2 className={s.emptyTitle}>{t('games.emptyTitle')}</h2>
          <p className={s.emptyText}>{emptyHint}</p>
          <div className={s.emptyActions}>
            <Link className={s.emptyLinkBtn} to="/">
              {t('games.openHomeAction')}
            </Link>
            {multiUser && user?.role === 'admin' && (
              <Link className={s.emptyLinkBtn} to="/settings">
                {t('games.openSettingsAction')}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className={s.grid}>
          {(data ?? []).map((game) => (
            <Link key={game.id} to={`/games/${game.id}`} className={s.tileLink}>
              <GameTile game={game} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

