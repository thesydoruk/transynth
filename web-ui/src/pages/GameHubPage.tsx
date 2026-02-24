/**
 * GameHubPage — game-level dashboard with quick navigation.
 *
 * Route: /games/:gameId
 *
 * Displays the selected game's info and provides links to the main
 * game-scoped sections:
 *   - Imported mods (translation workspace)
 *   - NexusMods browser (discover & import new mods)
 *   - Imports history
 *
 * Also shows aggregate translation statistics for all mods in this game.
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type GameInfo, type Mod } from '../api';
import { ProgressBar } from '../components/StatusBadge';
import s from './GameHubPage.module.scss';

/**
 * Aggregate stats computed from all mods in the current game.
 */
interface GameStats {
  modCount: number;
  totalStrings: number;
  translatedStrings: number;
  approvedStrings: number;
  fuzzyStrings: number;
  overallPct: number;
}

/**
 * Computes aggregate translation statistics from a list of mods.
 */
const computeStats = (mods: Mod[]): GameStats => {
  let totalStrings = 0;
  let translatedStrings = 0;
  let approvedStrings = 0;
  let fuzzyStrings = 0;

  for (const m of mods) {
    // API aggregate counters may arrive as strings from SQL COUNT(*), so
    // coerce explicitly to numbers to prevent string concatenation.
    totalStrings += Number(m.string_count) || 0;
    translatedStrings += Number(m.translated_count) || 0;
    approvedStrings += Number(m.approved_count) || 0;
    fuzzyStrings += Number(m.fuzzy_count) || 0;
  }

  const overallPct = totalStrings > 0 ? Math.round((translatedStrings / totalStrings) * 100) : 0;

  return { modCount: mods.length, totalStrings, translatedStrings, approvedStrings, fuzzyStrings, overallPct };
};

export const GameHubPage = () => {
  const { t, i18n } = useTranslation();
  const { gameId = '' } = useParams<{ gameId: string }>();

  /** Locale-aware compact formatter (thousands/millions/etc.) for counters. */
  const compactCountFmt = useMemo(
    () => new Intl.NumberFormat(i18n.language || 'uk-UA', {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    }),
    [i18n.language],
  );

  /* ── Queries ──────────────────────────────────────────────────────────── */

  /** Games catalogue (static, cached indefinitely). */
  const { data: games, isLoading: isGamesLoading, error: gamesError } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: Infinity,
  });

  /** Imported mods filtered by this game. */
  const { data: mods, isLoading: isModsLoading } = useQuery({
    queryKey: ['mods', gameId],
    queryFn: () => api.mods.list(gameId),
    enabled: !!gameId,
  });

  /** Resolved game metadata from catalogue. */
  const game: GameInfo | undefined = useMemo(
    () => games?.find((g) => g.id === gameId),
    [games, gameId],
  );

  /** Aggregate stats over all imported mods in this game. */
  const stats: GameStats | null = useMemo(
    () => (mods ? computeStats(mods) : null),
    [mods],
  );

  /* ── Loading / error states ───────────────────────────────────────────── */

  if (isGamesLoading) return <div className={s.loading}>{t('common.loading')}</div>;
  if (gamesError) return <div className={s.error}>{t('common.error', { message: String(gamesError) })}</div>;

  if (!game) {
    return (
      <div className={s.page}>
        <Link to="/" className={s.backLink}>{t('games.backToGames')}</Link>
        <h1 className={s.title}>{t('games.notFoundTitle')}</h1>
        <p className={s.subtitle}>{t('games.notFoundSubtitle')}</p>
      </div>
    );
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  return (
    <div className={s.page}>
      {/* Header with back link, cover thumbnail, game name */}
      <Link to="/" className={s.backLink}>{t('games.backToGames')}</Link>

      <div className={s.header}>
        <img
          src={api.games.coverUrl(game.id)}
          alt={game.name}
          className={s.cover}
          loading="lazy"
        />
        <div className={s.headerInfo}>
          <h1 className={s.title}>{game.name}</h1>
          <p className={s.meta}>
            {game.developer} &middot; {game.releaseYear} &middot; {game.engine}
          </p>
          <code className={s.gameId}>{game.id}</code>
        </div>
      </div>

      {/* Aggregate stats */}
      {stats && stats.modCount > 0 && (
        <div className={s.statsRow}>
          <div className={s.statCard}>
            <span className={s.statValue}>{compactCountFmt.format(stats.modCount)}</span>
            <span className={s.statLabel}>{t('gameHub.mods')}</span>
          </div>
          <div className={s.statCard}>
            <span className={s.statValue}>{compactCountFmt.format(stats.totalStrings)}</span>
            <span className={s.statLabel}>{t('gameHub.strings')}</span>
          </div>
          <div className={s.statCard}>
            <span className={s.statValue}>{stats.overallPct}%</span>
            <span className={s.statLabel}>{t('gameHub.translated')}</span>
          </div>
          <div className={s.statCard}>
            <span className={s.statValue}>
              {stats.totalStrings > 0
                ? Math.round((stats.approvedStrings / stats.totalStrings) * 100)
                : 0}%
            </span>
            <span className={s.statLabel}>{t('gameHub.approved')}</span>
          </div>
        </div>
      )}

      {/* Navigation cards */}
      <div className={s.navGrid}>
        <Link to={`/games/${gameId}/mods`} className={s.navCard}>
          <h2 className={s.navTitle}>{t('gameHub.modsLink')}</h2>
          <p className={s.navDesc}>{t('gameHub.modsDesc')}</p>
          {isModsLoading
            ? <span className={s.navMeta}>{t('common.loading')}</span>
            : <span className={s.navMeta}>{t('gameHub.modCount', { count: stats?.modCount ?? 0 })}</span>
          }
        </Link>

        <Link to={`/games/${gameId}/nexus`} className={s.navCard}>
          <h2 className={s.navTitle}>{t('gameHub.nexusLink')}</h2>
          <p className={s.navDesc}>{t('gameHub.nexusDesc')}</p>
        </Link>

        <Link to={`/games/${gameId}/imports`} className={s.navCard}>
          <h2 className={s.navTitle}>{t('gameHub.importsLink')}</h2>
          <p className={s.navDesc}>{t('gameHub.importsDesc')}</p>
        </Link>
      </div>

      {/* Recent mods quick list */}
      {mods && mods.length > 0 && (
        <div className={s.recentSection}>
          <h2 className={s.sectionTitle}>{t('gameHub.recentMods')}</h2>
          <table className={s.table}>
            <thead>
              <tr>
                <th>{t('mods.name')}</th>
                <th>{t('mods.strings')}</th>
                <th>{t('mods.progress')}</th>
              </tr>
            </thead>
            <tbody>
              {mods.slice(0, 10).map((mod) => {
                const pct = mod.string_count > 0
                  ? Math.round((mod.translated_count / mod.string_count) * 100)
                  : 0;
                return (
                  <tr key={mod.id}>
                    <td>
                      <Link to={`/games/${gameId}/mods/${mod.id}`} className={s.modLink}>
                        {mod.name}
                      </Link>
                    </td>
                    <td className={s.countCell}>{compactCountFmt.format(mod.string_count)}</td>
                    <td>
                      <ProgressBar
                        stats={{
                          total: mod.string_count,
                          translated: mod.translated_count,
                          approved: mod.approved_count,
                          draft: 0,
                          rejected: 0,
                          tm: 0,
                          fuzzy: mod.fuzzy_count,
                          auto_translated: mod.translated_count - mod.approved_count - mod.fuzzy_count,
                          untranslated: mod.string_count - mod.translated_count,
                          percent: pct,
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {mods.length > 10 && (
            <Link to={`/games/${gameId}/mods`} className={s.viewAll}>
              {t('gameHub.viewAllMods', { count: mods.length })}
            </Link>
          )}
        </div>
      )}
    </div>
  );
};
