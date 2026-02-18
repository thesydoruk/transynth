/**
 * GameModDetailsPage — detailed Nexus mod view.
 *
 * Route: /games/:gameId/mods/:modId
 *
 * Shows:
 * - full mod metadata (name, summary, description, stats)
 * - attached files list
 * - likely translation mods (heuristic ranking)
 */

import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type GameInfo, type NexusTranslationCandidate } from '../api';
import s from './GameModDetailsPage.module.scss';

export const GameModDetailsPage = () => {
  const { t } = useTranslation();
  const { gameId = '', modId = '' } = useParams<{ gameId: string; modId: string }>();

  const numericModId = Number(modId);

  const {
    data: games,
    isLoading: isGamesLoading,
    error: gamesError,
  } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: Infinity,
  });

  const game: GameInfo | undefined = useMemo(
    () => games?.find((g) => g.id === gameId),
    [games, gameId],
  );

  const {
    data: details,
    isLoading: isDetailsLoading,
    error: detailsError,
  } = useQuery({
    queryKey: ['nexus-mod-details', gameId, numericModId],
    queryFn: () => api.games.modDetails(gameId, numericModId),
    enabled: !!game && Number.isFinite(numericModId) && numericModId > 0,
  });

  const {
    data: translations,
    isLoading: isTranslationsLoading,
    error: translationsError,
  } = useQuery({
    queryKey: ['nexus-translations', gameId, numericModId],
    queryFn: () => api.games.findTranslations(gameId, numericModId, undefined, 50),
    enabled: !!game && Number.isFinite(numericModId) && numericModId > 0,
  });

  if (isGamesLoading) return <div className={s.loading}>{t('common.loading')}</div>;
  if (gamesError) return <div className={s.error}>{t('common.error', { message: String(gamesError) })}</div>;

  if (!game || !Number.isFinite(numericModId) || numericModId <= 0) {
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
        <Link to={`/games/${gameId}`} className={s.backLink}>{t('games.backToMods')}</Link>
        <h1 className={s.title}>{details?.mod.name ?? t('common.loading')}</h1>
        <p className={s.subtitle}>{t('games.modIdLabel', { modId: numericModId })}</p>
      </div>

      {detailsError && <div className={s.error}>{t('common.error', { message: String(detailsError) })}</div>}
      {isDetailsLoading && <div className={s.loading}>{t('common.loading')}</div>}

      {details && (
        <>
          <section className={s.section}>
            <h2 className={s.h2}>{t('games.modInfo')}</h2>

            {details.mod.pictureUrl && (
              <div className={s.heroWrap}>
                <img
                  src={details.mod.pictureUrl}
                  alt={details.mod.name}
                  className={s.heroImage}
                  loading="lazy"
                />
              </div>
            )}

            <p className={s.summary}>{details.mod.summary || t('games.noSummary')}</p>
            <div className={s.metaGrid}>
              <span className={s.chip}>{t('games.downloads', { count: details.mod.downloads.toLocaleString() })}</span>
              <span className={s.chip}>{t('games.endorsements', { count: details.mod.endorsements.toLocaleString() })}</span>
              <span className={s.chip}>{details.mod.version}</span>
              <span className={s.chip}>{details.mod.category ?? '-'}</span>
            </div>
            {details.mod.description && (
              <div
                className={s.description}
                dangerouslySetInnerHTML={{ __html: renderNexusDescription(details.mod.description) }}
              />
            )}
          </section>

          <section className={s.section}>
            <h2 className={s.h2}>{t('games.filesTitle')}</h2>
            {details.files.length === 0 ? (
              <p className={s.empty}>{t('games.noFiles')}</p>
            ) : (
              <div className={s.filesTableWrap}>
                <table className={s.filesTable}>
                  <thead>
                    <tr>
                      <th>{t('games.fileName')}</th>
                      <th>{t('games.fileCategory')}</th>
                      <th>{t('games.fileVersion')}</th>
                      <th>{t('games.fileSize')}</th>
                      <th>{t('games.fileUploaded')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.files.map((f) => (
                      <tr key={f.fileId}>
                        <td>
                          <div className={s.fileNameCell}>
                            {f.name}
                            {f.isPrimary && <span className={s.primaryBadge}>{t('games.primaryFile')}</span>}
                          </div>
                        </td>
                        <td>{f.categoryName ?? '-'}</td>
                        <td>{f.version ?? '-'}</td>
                        <td>{fmtBytes(f.sizeBytes)}</td>
                        <td>{f.uploadedTime ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <section className={s.section}>
        <h2 className={s.h2}>{t('games.likelyTranslations')}</h2>
        {translationsError && <p className={s.error}>{t('common.error', { message: String(translationsError) })}</p>}
        {isTranslationsLoading && <p className={s.loading}>{t('common.loading')}</p>}
        {!isTranslationsLoading && translations && (
          translations.items.length === 0 ? (
            <p className={s.empty}>{t('games.noTranslations')}</p>
          ) : (
            <div className={s.translationsGrid}>
              {translations.items.slice(0, 24).map((row) => (
                <TranslationCard key={`${row.mod.game.domainName}-${row.mod.modId}`} gameDomain={game.domainName} row={row} />
              ))}
            </div>
          )
        )}
      </section>
    </div>
  );
};

const TranslationCard = ({ gameDomain, row }: { gameDomain: string; row: NexusTranslationCandidate }) => {
  const { t } = useTranslation();
  return (
    <article className={s.translationCard}>
      <h3 className={s.translationTitle}>{row.mod.name}</h3>
      <p className={s.translationSummary}>{row.mod.summary || t('games.noSummary')}</p>
      <div className={s.translationMeta}>
        <span className={s.chip}>{t('games.scoreLabel', { score: row.score })}</span>
        <span className={s.chip}>{t('games.downloads', { count: row.mod.downloads.toLocaleString() })}</span>
      </div>
      <a
        className={s.openLink}
        href={`https://www.nexusmods.com/${gameDomain}/mods/${row.mod.modId}`}
        target="_blank"
        rel="noreferrer"
      >
        {t('games.openOnNexus')}
      </a>
    </article>
  );
};

const fmtBytes = (bytes: number | null): string => {
  if (bytes == null || !Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

/**
 * Converts common Nexus BBCode fragments to simple HTML.
 *
 * Nexus descriptions often contain mixed BBCode + HTML (`<br />`), so we keep
 * existing HTML tags and normalize the most common BBCode tokens that appear
 * in mod pages: size/center/list/url/img/color/bold/italic/underline.
 */
const renderNexusDescription = (raw: string): string => {
  let html = raw;

  // Basic formatting tags
  html = html.replace(/\[b\](.*?)\[\/b\]/gis, '<strong>$1</strong>');
  html = html.replace(/\[i\](.*?)\[\/i\]/gis, '<em>$1</em>');
  html = html.replace(/\[u\](.*?)\[\/u\]/gis, '<u>$1</u>');
  html = html.replace(/\[center\](.*?)\[\/center\]/gis, '<div class="bb-center">$1</div>');

  // Color tags
  html = html.replace(/\[color=(.*?)\](.*?)\[\/color\]/gis, (_m, color, text) => {
    const safeColor = sanitizeColor(color);
    return safeColor
      ? `<span style="color:${safeColor}">${text}</span>`
      : String(text);
  });

  // URL tags
  html = html.replace(/\[url=(.*?)\](.*?)\[\/url\]/gis, (_m, href, text) => {
    const safeHref = sanitizeExternalUrl(href);
    return safeHref
      ? `<a href="${safeHref}" target="_blank" rel="noreferrer">${text}</a>`
      : String(text);
  });
  html = html.replace(/\[url\](.*?)\[\/url\]/gis, (_m, href) => {
    const safeHref = sanitizeExternalUrl(href);
    return safeHref
      ? `<a href="${safeHref}" target="_blank" rel="noreferrer">${safeHref}</a>`
      : String(href);
  });

  // Image tags
  html = html.replace(/\[img\](.*?)\[\/img\]/gis, (_m, src) => {
    const safeSrc = sanitizeExternalImageUrl(src);
    return safeSrc
      ? `<img class="bb-inline-image" src="${safeSrc}" alt="mod description image" loading="lazy" />`
      : '';
  });

  // Size tags (map Nexus size scale to simple em values)
  html = html.replace(/\[size=(\d+)\](.*?)\[\/size\]/gis, (_m, size, text) => {
    const n = Number(size);
    const clamped = Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 3;
    const em = 0.8 + clamped * 0.1;
    return `<span style="font-size:${em.toFixed(2)}em">${text}</span>`;
  });

  // Lists: convert [list]/[list=1] and [*] markers to HTML lists
  html = html.replace(/\[list=1\]/gi, '<ul>');
  html = html.replace(/\[list\]/gi, '<ul>');
  html = html.replace(/\[\/list\]/gi, '</ul>');
  html = html.replace(/\[\*\]/g, '<li>');

  // Close list items heuristically before next <li> or list end
  html = html.replace(/<li>([\s\S]*?)(?=<li>|<\/ul>)/g, '<li>$1</li>');

  // Fix malformed <br //> variants seen in some descriptions
  html = html.replace(/<br\s*\/\/>/gi, '<br />');

  // Also repair malformed tag seen as <br //>
  html = html.replace(/<br\s*\/\s*>/gi, '<br />');

  // Keep plain line breaks from BBCode-rich descriptions.
  html = html.replace(/\r\n|\r|\n/g, '<br />');

  return html;
};

/**
 * Allows only http/https links in rendered Nexus descriptions.
 */
const sanitizeExternalUrl = (value: string): string | null => {
  const href = String(value).trim();
  if (/^https?:\/\//i.test(href)) return href;
  return null;
};

/**
 * Allows only safe HTTP(S) image URLs.
 */
const sanitizeExternalImageUrl = (value: string): string | null => {
  const src = sanitizeExternalUrl(value);
  return src;
};

/**
 * Allows hex and a small whitelist of CSS color keywords for BBCode [color].
 */
const sanitizeColor = (value: string): string | null => {
  const color = String(value).trim().toLowerCase();

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    return color;
  }

  const allowed = new Set([
    'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink',
    'white', 'black', 'gray', 'grey', 'cyan', 'magenta',
  ]);

  if (allowed.has(color)) {
    return color;
  }

  return null;
};
