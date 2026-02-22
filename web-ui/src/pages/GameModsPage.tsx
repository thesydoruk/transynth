/**
 * GameModsPage — NexusMods search page for one selected game.
 *
 * Entry route: /games/:gameId
 *
 * Main responsibilities:
 * 1. Resolve the selected game by `gameId` from the games catalogue.
 * 2. Provide a search form for NexusMods mod title lookup or full browse mode.
 * 3. Render the results as responsive cards (tiles).
 * 4. Keep loading/error/empty states explicit and user-friendly.
 */

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type GameInfo, type NexusModItem } from '../api';
import s from './GameModsPage.module.scss';

/**
 * Game-scoped mod search page.
 *
 * Uses two queries:
 * - `/api/games` to resolve game metadata for the path parameter
 * - `/api/games/:gameId/nexus/mods` for the actual search results
 */
export const GameModsPage = () => {
  const { t } = useTranslation();
  const { gameId = '' } = useParams<{ gameId: string }>();
  const pageSize = 24;

  /** Controlled input state for the search box. */
  const [queryInput, setQueryInput] = useState('');

  /**
   * Effective query used by React Query.
  * We update this only on form submit to avoid firing a request on every key.
  * An empty query means "browse all mods for this game".
   */
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(1);

  /** Load games catalogue (static) to resolve selected game details. */
  const {
    data: games,
    isLoading: isGamesLoading,
    error: gamesError,
  } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: Infinity,
  });

  /** Selected game resolved from route param. */
  const game: GameInfo | undefined = useMemo(
    () => games?.find((g) => g.id === gameId),
    [games, gameId],
  );

  /**
  * Query NexusMods after the game is known.
  * Empty query = paginated browse mode over all mods in the selected game.
   */
  const {
    data: modsPage,
    isFetching: isModsLoading,
    error: modsError,
  } = useQuery({
    queryKey: ['nexus-mods', gameId, submittedQuery, page, pageSize],
    queryFn: () => api.games.searchMods(gameId, submittedQuery, pageSize, (page - 1) * pageSize),
    enabled: !!game,
  });

  const totalPages = modsPage ? Math.max(1, Math.ceil(modsPage.totalCount / pageSize)) : 1;
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  /**
   * Handles search form submit:
   * - trims whitespace
   * - updates effective submitted query
   */
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const normalized = queryInput.trim();
    setSubmittedQuery(normalized);
    setPage(1);
  };

  if (isGamesLoading) {
    return <div className={s.loading}>{t('common.loading')}</div>;
  }

  if (gamesError) {
    return <div className={s.error}>{t('common.error', { message: String(gamesError) })}</div>;
  }

  if (!game) {
    return (
      <div className={s.page}>
        <Link to="/games" className={s.backLink}>{t('games.backToGames')}</Link>
        <h1 className={s.title}>{t('games.notFoundTitle')}</h1>
        <p className={s.subtitle}>{t('games.notFoundSubtitle')}</p>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.header}>
        <Link to="/games" className={s.backLink}>{t('games.backToGames')}</Link>
        <h1 className={s.title}>{t('games.modsTitle', { game: game.name })}</h1>
        <p className={s.subtitle}>{t('games.modsSubtitle')}</p>
      </div>

      <form className={s.searchBar} onSubmit={onSubmit}>
        <input
          className={s.searchInput}
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder={t('games.searchPlaceholder')}
          aria-label={t('games.searchPlaceholder')}
        />
        <button className={s.searchButton} type="submit">
          {t('games.searchAction')}
        </button>
      </form>

      <p className={s.hint}>{t('games.searchHint')}</p>

      {modsError && (
        <div className={s.error}>{t('common.error', { message: String(modsError) })}</div>
      )}

      {isModsLoading && <p className={s.loading}>{t('common.loading')}</p>}

      {!isModsLoading && modsPage && (
        <>
          <p className={s.count}>
            {submittedQuery.trim().length > 0
              ? t('games.resultsCount', {
                  count: modsPage.totalCount.toLocaleString(),
                  query: submittedQuery,
                })
              : t('games.resultsCountAll', {
                  count: modsPage.totalCount.toLocaleString(),
                  game: game.name,
                })}
          </p>

          {modsPage.items.length === 0 ? (
            <p className={s.empty}>{t('games.noResults')}</p>
          ) : (
            <>
              <div className={s.grid}>
                {modsPage.items.map((mod) => (
                  <ModTile key={`${mod.game.domainName}-${mod.modId}`} game={game} mod={mod} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className={s.pagination}>
                  <button
                    type="button"
                    className={s.paginationButton}
                    disabled={!canGoPrev || isModsLoading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('common.prev')}
                  </button>

                  <span className={s.paginationInfo}>
                    {t('common.pageWithTotal', {
                      page,
                      totalPages,
                      total: modsPage.totalCount.toLocaleString(),
                    })}
                  </span>

                  <button
                    type="button"
                    className={s.paginationButton}
                    disabled={!canGoNext || isModsLoading}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    {t('common.next')}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Renders one NexusMods mod card.
 *
 * Includes thumbnail fallback handling and a direct link to the original
 * mod page on NexusMods.
 */
const ModTile = ({ game, mod }: { game: GameInfo; mod: NexusModItem }) => {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);

  /**
   * Prefer thumbnail for faster loads; fallback to full picture URL.
   * If both are absent, render the placeholder state.
   */
  const imageUrl = mod.thumbnailUrl || mod.pictureUrl;

  /** Canonical NexusMods URL for the mod details page. */
  const modUrl = `https://www.nexusmods.com/${game.domainName}/mods/${mod.modId}`;

  return (
    <article className={s.card}>
      <div className={s.imageWrap}>
        {!imgError && imageUrl ? (
          <img
            className={s.image}
            src={imageUrl}
            alt={mod.name}
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className={s.imageFallback}>{mod.name.slice(0, 2).toUpperCase()}</div>
        )}
      </div>

      <div className={s.cardBody}>
        <h3 className={s.modName}>
          <Link to={`/games/${game.id}/mods/${mod.modId}`} className={s.cardLink}>
            {mod.name}
          </Link>
        </h3>
        <p className={s.summary}>{mod.summary || t('games.noSummary')}</p>

        <div className={s.meta}>
          <span className={s.metaChip}>{t('games.downloads', { count: mod.downloads.toLocaleString() })}</span>
          <span className={s.metaChip}>{t('games.endorsements', { count: mod.endorsements.toLocaleString() })}</span>
        </div>

        <div className={s.footer}>
          <span className={s.author}>{mod.author || t('games.unknownAuthor')}</span>
          <a className={s.openLink} href={modUrl} target="_blank" rel="noreferrer">
            {t('games.openOnNexus')}
          </a>
        </div>
      </div>
    </article>
  );
};
