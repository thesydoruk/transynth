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

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type GameInfo } from '../api';
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

  const { data, isLoading, error } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className={s.page}>
        <h1 className={s.title}>{t('games.title')}</h1>
        <div className={s.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`${s.tile} ${s.skeleton}`} />
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

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('games.title')}</h1>
      <p className={s.subtitle}>{t('games.subtitle')}</p>
      <div className={s.grid}>
        {(data ?? []).map((game) => (
          <Link key={game.id} to={`/games/${game.id}`} className={s.tileLink}>
            <GameTile game={game} />
          </Link>
        ))}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * GameTile — a single game card in the grid.
 *
 * Renders the cover image via the backend proxy endpoint.  While the image is
 * loading a grey skeleton is shown; if the image fails to load a fallback
 * placeholder with the game initials is displayed instead.
 */
const GameTile = ({ game }: { game: GameInfo }) => {
  const { t } = useTranslation();
  const [imgState, setImgState] = useState<'loading' | 'loaded' | 'error'>('loading');

  /** Initials fallback shown when the cover cannot be loaded. */
  const initials = game.name
    .split(' ')
    .filter(w => /^[A-Z0-9]/i.test(w))
    .map(w => w[0]!.toUpperCase())
    .slice(0, 3)
    .join('');

  return (
    <div className={s.tile}>
      {/* ── Cover art ─────────────────────────────────────────────────── */}
      <div className={s.cover}>
        {/* Skeleton overlay while image is still loading */}
        {imgState === 'loading' && <div className={s.coverSkeleton} />}

        {/* Initials fallback when image failed */}
        {imgState === 'error' && (
          <div className={s.coverFallback}>
            <span className={s.initials}>{initials}</span>
          </div>
        )}

        {/* Actual cover image — hidden until loaded to avoid flash */}
        <img
          src={api.games.coverUrl(game.id)}
          alt={game.name}
          className={`${s.coverImg} ${imgState === 'loaded' ? s.coverImgVisible : ''}`}
          onLoad={() => setImgState('loaded')}
          onError={() => setImgState('error')}
          loading="lazy"
        />
      </div>

      {/* ── Tile body ─────────────────────────────────────────────────── */}
      <div className={s.body}>
        {/* Game title + year */}
        <div className={s.titleRow}>
          <span className={s.gameName}>{game.name}</span>
          <span className={s.year}>{game.releaseYear}</span>
        </div>

        {/* Developer */}
        <div className={s.developer}>{game.developer}</div>

        {/* Tags row */}
        <div className={s.tags}>
          {/* Engine */}
          <span className={s.tag}>{game.engine}</span>

          {/* Localization method badge */}
          <span className={`${s.tag} ${game.localized ? s.tagLocalized : s.tagInline}`}>
            {game.localized ? t('games.localizedPlugin') : t('games.inlinePlugin')}
          </span>
        </div>

        {/* Game ID chip */}
        <div className={s.idRow}>
          <code className={s.gameId}>{game.id}</code>
        </div>
      </div>
    </div>
  );
};
