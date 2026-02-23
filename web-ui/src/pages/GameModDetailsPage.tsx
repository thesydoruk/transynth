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

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  api,
  type GameInfo,
  type NexusModFile,
  type NexusModRelationItem,
  type NexusTranslationCandidate,
} from '../api';
import s from './GameModDetailsPage.module.scss';

type RelationsTabKey = 'possibleTranslations' | 'requires' | 'requiredBy';

export const GameModDetailsPage = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { gameId = '', modId = '' } = useParams<{ gameId: string; modId: string }>();
  const [activeTab, setActiveTab] = useState<RelationsTabKey>('possibleTranslations');
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [fileActionInfo, setFileActionInfo] = useState<string | null>(null);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

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

  const {
    data: relations,
    isLoading: isRelationsLoading,
    error: relationsError,
  } = useQuery({
    queryKey: ['nexus-mod-relations', gameId, numericModId],
    queryFn: () => api.games.modRelations(gameId, numericModId, 100),
    enabled: !!game && Number.isFinite(numericModId) && numericModId > 0,
  });

  const groupedTranslations = useMemo(
    () => groupTranslationsByLanguage(translations?.items ?? []),
    [translations?.items],
  );

  const handleFileDownload = async (file: NexusModFile) => {
    setFileActionError(null);
    setFileActionInfo(null);
    setBusyActionKey(`download:${file.fileId}`);

    try {
      await api.games.downloadModFile(gameId, numericModId, file.fileId, file.fileName ?? file.name);
    } catch (error) {
      setFileActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleFileImport = async (file: NexusModFile) => {
    setFileActionError(null);
    setFileActionInfo(null);
    setBusyActionKey(`import:${file.fileId}`);

    try {
      const job = await api.games.importModFile(gameId, numericModId, file.fileId);

      if (job.running) {
        setFileActionInfo(t('games.fileImportAlreadyRunning'));
        setBusyActionKey(null);
        return;
      }

      if (job.status === 'completed') {
        setFileActionInfo(t('games.fileImportAlreadyCompleted'));
        setBusyActionKey(null);
        return;
      }

      setFileActionInfo(t('games.fileImportStarted', { name: file.name }));
      qc.invalidateQueries({ queryKey: ['mod-imports'] });

      const { promise } = api.modImport.startImport(job.id);
      void promise
        .then(() => {
          qc.invalidateQueries({ queryKey: ['mod-imports'] });
          setFileActionInfo(t('games.fileImportFinished', { name: file.name }));
        })
        .catch((error) => {
          setFileActionError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setBusyActionKey((current) => (current === `import:${file.fileId}` ? null : current));
        });

      return;
    } catch (error) {
      setFileActionError(error instanceof Error ? error.message : String(error));
    }

    setBusyActionKey(null);
  };

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
            {fileActionError && <p className={s.error}>{fileActionError}</p>}
            {fileActionInfo && <p className={s.hint}>{fileActionInfo}</p>}
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
                      <th>{t('games.fileActions')}</th>
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
                        <td>
                          <div className={s.fileActions}>
                            <button
                              type="button"
                              className={s.fileActionButton}
                              onClick={() => handleFileDownload(f)}
                              disabled={busyActionKey === `download:${f.fileId}` || busyActionKey === `import:${f.fileId}`}
                            >
                              {busyActionKey === `download:${f.fileId}`
                                ? t('games.fileDownloading')
                                : t('games.fileDownloadAction')}
                            </button>

                            <button
                              type="button"
                              className={s.fileActionButton}
                              onClick={() => handleFileImport(f)}
                              disabled={!isImportableNexusFile(f.fileName ?? f.name) || busyActionKey === `import:${f.fileId}` || busyActionKey === `download:${f.fileId}`}
                              title={!isImportableNexusFile(f.fileName ?? f.name) ? t('games.fileImportUnsupported') : undefined}
                            >
                              {busyActionKey === `import:${f.fileId}`
                                ? t('games.fileImporting')
                                : t('games.fileImportAction')}
                            </button>
                          </div>
                        </td>
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
        <h2 className={s.h2}>{t('games.relationsTitle')}</h2>

        <div className={s.tabs} role="tablist" aria-label={t('games.relationsTitle')}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'possibleTranslations'}
            className={activeTab === 'possibleTranslations' ? `${s.tab} ${s.tabActive}` : s.tab}
            onClick={() => setActiveTab('possibleTranslations')}
          >
            {t('games.tabPossibleTranslations')}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'requires'}
            className={activeTab === 'requires' ? `${s.tab} ${s.tabActive}` : s.tab}
            onClick={() => setActiveTab('requires')}
          >
            {t('games.tabRequires')}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'requiredBy'}
            className={activeTab === 'requiredBy' ? `${s.tab} ${s.tabActive}` : s.tab}
            onClick={() => setActiveTab('requiredBy')}
          >
            {t('games.tabRequiredBy')}
          </button>
        </div>

        {activeTab === 'possibleTranslations' && (
          <div role="tabpanel" className={s.tabPanel}>
            {translationsError && <p className={s.error}>{t('common.error', { message: String(translationsError) })}</p>}
            {isTranslationsLoading && <p className={s.loading}>{t('common.loading')}</p>}
            {!isTranslationsLoading && translations && (
              groupedTranslations.length === 0 ? (
                <p className={s.empty}>{t('games.noTranslations')}</p>
              ) : (
                <div className={s.translationGroups}>
                  {groupedTranslations.map((group) => (
                    <section className={s.translationGroup} key={group.key}>
                      <h3 className={s.translationGroupTitle}>
                        <span className={s.languageFlag} aria-hidden="true">
                          {group.flagImageUrl ? (
                            <img
                              src={group.flagImageUrl}
                              alt=""
                              className={s.languageFlagImage}
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span className={s.languageFlagFallback}>?</span>
                          )}
                        </span>
                        <span>{t(group.labelKey)}</span>
                        <span className={s.groupCount}>{t('games.groupCountLabel', { count: group.items.length })}</span>
                      </h3>

                      <ul className={s.translationList}>
                        {group.items.map((row) => (
                          <TranslationListItem
                            key={`${row.mod.game.domainName}-${row.mod.modId}`}
                            gameDomain={game.domainName}
                            row={row}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {activeTab === 'requires' && (
          <div role="tabpanel" className={s.tabPanel}>
            <RelationsTabContent
              isLoading={isRelationsLoading}
              error={relationsError}
              emptyText={t('games.noRequires')}
              gameDomain={game.domainName}
              items={relations?.requires ?? []}
            />
          </div>
        )}

        {activeTab === 'requiredBy' && (
          <div role="tabpanel" className={s.tabPanel}>
            <RelationsTabContent
              isLoading={isRelationsLoading}
              error={relationsError}
              emptyText={t('games.noRequiredBy')}
              gameDomain={game.domainName}
              items={relations?.requiredBy ?? []}
            />
          </div>
        )}
      </section>
    </div>
  );
};

/**
 * Only plugin and archive Nexus files can enter the mod import pipeline.
 */
const isImportableNexusFile = (fileName: string): boolean => {
  return /\.(esp|esm|esl|zip|7z|rar)$/i.test(fileName);
};

type RelationsTabContentProps = {
  isLoading: boolean;
  error: unknown;
  emptyText: string;
  gameDomain: string;
  items: NexusModRelationItem[];
};

const RelationsTabContent = ({
  isLoading,
  error,
  emptyText,
  gameDomain,
  items,
}: RelationsTabContentProps) => {
  const { t } = useTranslation();

  if (error) {
    return <p className={s.error}>{t('common.error', { message: String(error) })}</p>;
  }

  if (isLoading) {
    return <p className={s.loading}>{t('common.loading')}</p>;
  }

  if (items.length === 0) {
    return <p className={s.empty}>{emptyText}</p>;
  }

  return (
    <ul className={s.relationList}>
      {items.map((item) => (
        <li key={`${item.modId}-${item.modName}`} className={s.relationListItem}>
          <div className={s.relationRowMain}>
            <h4 className={s.relationTitle}>{item.modName}</h4>
            {item.externalRequirement && (
              <span className={s.chip}>{t('games.externalRequirement')}</span>
            )}
          </div>

          {item.notes && <p className={s.relationNotes}>{item.notes}</p>}

          {item.modId > 0 && (
            <a
              className={s.openLink}
              href={`https://www.nexusmods.com/${gameDomain}/mods/${item.modId}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('games.openOnNexus')}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
};

const TranslationListItem = ({ gameDomain, row }: { gameDomain: string; row: NexusTranslationCandidate }) => {
  const { t } = useTranslation();
  return (
    <li className={s.translationListItem}>
      <div className={s.translationRowMain}>
        <h4 className={s.translationTitle}>{row.mod.name}</h4>
        <div className={s.translationMeta}>
          <span className={s.chip}>{t('games.scoreLabel', { score: row.score })}</span>
          <span className={s.chip}>{t('games.downloads', { count: row.mod.downloads.toLocaleString() })}</span>
        </div>
      </div>

      <p className={s.translationSummary}>{row.mod.summary || t('games.noSummary')}</p>

      <a
        className={s.openLink}
        href={`https://www.nexusmods.com/${gameDomain}/mods/${row.mod.modId}`}
        target="_blank"
        rel="noreferrer"
      >
        {t('games.openOnNexus')}
      </a>
    </li>
  );
};

type TranslationLanguageKey =
  | 'ukrainian'
  | 'russian'
  | 'polish'
  | 'german'
  | 'french'
  | 'spanish'
  | 'portuguese'
  | 'brazilianPortuguese'
  | 'italian'
  | 'dutch'
  | 'swedish'
  | 'norwegian'
  | 'danish'
  | 'finnish'
  | 'czech'
  | 'slovak'
  | 'slovenian'
  | 'hungarian'
  | 'romanian'
  | 'croatian'
  | 'serbian'
  | 'bulgarian'
  | 'greek'
  | 'turkish'
  | 'japanese'
  | 'korean'
  | 'chinese'
  | 'thai'
  | 'vietnamese'
  | 'indonesian'
  | 'english'
  | 'unknown';

type TranslationGroup = {
  key: TranslationLanguageKey;
  labelKey: string;
  flagImageUrl: string | null;
  items: NexusTranslationCandidate[];
  topScore: number;
};

const LANGUAGE_SPECS: Array<{ key: Exclude<TranslationLanguageKey, 'unknown'>; countryCode: string; patterns: string[] }> = [
  { key: 'ukrainian', countryCode: 'ua', patterns: ['ukrainian', 'ukraine', 'україн', 'укр', 'ua'] },
  { key: 'russian', countryCode: 'ru', patterns: ['russian', 'рус', 'руськ', 'ru'] },
  { key: 'polish', countryCode: 'pl', patterns: ['polish', 'polski', 'polska', 'pl'] },
  { key: 'german', countryCode: 'de', patterns: ['german', 'deutsch', 'de'] },
  { key: 'french', countryCode: 'fr', patterns: ['french', 'francais', 'français', 'fr'] },
  { key: 'spanish', countryCode: 'es', patterns: ['spanish', 'espanol', 'español', 'es'] },
  { key: 'portuguese', countryCode: 'pt', patterns: ['portuguese', 'portugues', 'português', 'pt'] },
  { key: 'brazilianPortuguese', countryCode: 'br', patterns: ['brazilian portuguese', 'pt br', 'pt-br', 'brasil', 'brasileiro'] },
  { key: 'italian', countryCode: 'it', patterns: ['italian', 'italiano', 'it'] },
  { key: 'dutch', countryCode: 'nl', patterns: ['dutch', 'nederlands', 'nl'] },
  { key: 'swedish', countryCode: 'se', patterns: ['swedish', 'svenska', 'sv'] },
  { key: 'norwegian', countryCode: 'no', patterns: ['norwegian', 'norsk', 'no'] },
  { key: 'danish', countryCode: 'dk', patterns: ['danish', 'dansk', 'da'] },
  { key: 'finnish', countryCode: 'fi', patterns: ['finnish', 'suomi', 'fi'] },
  { key: 'czech', countryCode: 'cz', patterns: ['czech', 'cestina', 'čeština', 'cz'] },
  { key: 'slovak', countryCode: 'sk', patterns: ['slovak', 'slovencina', 'slovenčina', 'sk'] },
  { key: 'slovenian', countryCode: 'si', patterns: ['slovenian', 'slovenscina', 'slovenščina', 'sl'] },
  { key: 'hungarian', countryCode: 'hu', patterns: ['hungarian', 'magyar', 'hu'] },
  { key: 'romanian', countryCode: 'ro', patterns: ['romanian', 'romana', 'română', 'ro'] },
  { key: 'croatian', countryCode: 'hr', patterns: ['croatian', 'hrvatski', 'hr'] },
  { key: 'serbian', countryCode: 'rs', patterns: ['serbian', 'srpski', 'sr'] },
  { key: 'bulgarian', countryCode: 'bg', patterns: ['bulgarian', 'български', 'bg'] },
  { key: 'greek', countryCode: 'gr', patterns: ['greek', 'ελληνικά', 'el'] },
  { key: 'turkish', countryCode: 'tr', patterns: ['turkish', 'turkce', 'türkçe', 'tr'] },
  { key: 'japanese', countryCode: 'jp', patterns: ['japanese', '日本語', 'jp'] },
  { key: 'korean', countryCode: 'kr', patterns: ['korean', '한국어', 'kr'] },
  { key: 'chinese', countryCode: 'cn', patterns: ['chinese', '中文', 'zh', 'cn'] },
  { key: 'thai', countryCode: 'th', patterns: ['thai', 'ไทย', 'th'] },
  { key: 'vietnamese', countryCode: 'vn', patterns: ['vietnamese', 'tieng viet', 'tiếng việt', 'vi'] },
  { key: 'indonesian', countryCode: 'id', patterns: ['indonesian', 'bahasa indonesia', 'id'] },
  { key: 'english', countryCode: 'gb', patterns: ['english', 'eng', 'en'] },
];

/**
 * Groups translation candidates by inferred language.
 *
 * Language detection is heuristic and checks tags first, then title/summary.
 * This mirrors Nexus naming conventions where language is often encoded in
 * tags or in mod names like "Ukrainian Translation".
 */
const groupTranslationsByLanguage = (items: NexusTranslationCandidate[]): TranslationGroup[] => {
  const groups = new Map<TranslationLanguageKey, TranslationGroup>();

  for (const row of items) {
    const key = detectTranslationLanguage(row.mod);
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(row);
      existing.topScore = Math.max(existing.topScore, row.score);
      continue;
    }

    const spec = LANGUAGE_SPECS.find((entry) => entry.key === key);
    groups.set(key, {
      key,
      labelKey: `games.language.${key}`,
      flagImageUrl: spec ? getFlagImageUrl(spec.countryCode) : null,
      items: [row],
      topScore: row.score,
    });
  }

  return [...groups.values()]
    .filter((group) => group.key !== 'unknown')
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => b.score - a.score),
    }))
    .sort((a, b) => {
      if (b.topScore !== a.topScore) return b.topScore - a.topScore;
      return a.labelKey.localeCompare(b.labelKey);
    });
};

/**
 * Infers translation language from tags/name/summary.
 */
const detectTranslationLanguage = (mod: NexusTranslationCandidate['mod']): TranslationLanguageKey => {
  const normalizedTags = mod.tags.map((tag) => normalizeForLanguageMatch(tag));
  const haystack = normalizeForLanguageMatch(`${mod.name} ${mod.summary} ${mod.category ?? ''}`);

  // Tags are usually the strongest language signal on Nexus.
  for (const spec of LANGUAGE_SPECS) {
    if (normalizedTags.some((tag) => spec.patterns.some((pattern) => textMatchesLanguagePattern(tag, pattern)))) {
      return spec.key;
    }
  }

  for (const spec of LANGUAGE_SPECS) {
    if (spec.patterns.some((pattern) => textMatchesLanguagePattern(haystack, pattern))) {
      return spec.key;
    }
  }

  // Fallback heuristic: infer target language by the language of the word
  // "translation" used in the title/summary (e.g. "переклад", "traduction").
  const byTranslationWord = detectLanguageByTranslationWord(haystack);
  if (byTranslationWord) {
    return byTranslationWord;
  }

  return 'unknown';
};

const TRANSLATION_WORD_LANGUAGE_HINTS: Array<{
  key: Exclude<TranslationLanguageKey, 'unknown'>;
  patterns: string[];
}> = [
  { key: 'ukrainian', patterns: ['переклад', 'українізатор'] },
  { key: 'russian', patterns: ['перевод'] },
  { key: 'polish', patterns: ['tlumaczenie', 'tłumaczenie'] },
  { key: 'german', patterns: ['ubersetzung', 'übersetzung'] },
  { key: 'french', patterns: ['traduction'] },
  { key: 'spanish', patterns: ['traduccion', 'traducción'] },
  { key: 'portuguese', patterns: ['traducao', 'tradução'] },
  { key: 'italian', patterns: ['traduzione'] },
  { key: 'hungarian', patterns: ['forditas', 'fordítás'] },
  { key: 'czech', patterns: ['preklad', 'překlad'] },
  { key: 'turkish', patterns: ['ceviri', 'çeviri'] },
  { key: 'greek', patterns: ['μετάφραση', 'μεταφραση'] },
  { key: 'japanese', patterns: ['翻訳'] },
  { key: 'korean', patterns: ['번역'] },
  { key: 'chinese', patterns: ['翻译', '翻譯'] },
  { key: 'thai', patterns: ['แปล'] },
  { key: 'vietnamese', patterns: ['ban dich', 'bản dịch'] },
  { key: 'english', patterns: ['translation'] },
];

/**
 * Infers language from localized words meaning "translation".
 */
const detectLanguageByTranslationWord = (
  normalizedText: string,
): Exclude<TranslationLanguageKey, 'unknown'> | null => {
  for (const spec of TRANSLATION_WORD_LANGUAGE_HINTS) {
    if (spec.patterns.some((pattern) => textMatchesLanguagePattern(normalizedText, pattern))) {
      return spec.key;
    }
  }

  return null;
};

/**
 * Produces a lowercase text form suitable for language keyword matching.
 */
const normalizeForLanguageMatch = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Matches language markers in normalized text.
 *
 * Two-letter markers like "ua"/"pl"/"ru" are treated as standalone tokens
 * only, preventing false matches inside words (e.g. "eventualmente").
 */
const textMatchesLanguagePattern = (normalizedText: string, rawPattern: string): boolean => {
  const pattern = normalizeForLanguageMatch(rawPattern);
  if (!pattern) return false;

  if (pattern.length <= 2) {
    const tokens = normalizedText.split(' ').filter(Boolean);
    return tokens.includes(pattern);
  }

  return normalizedText.includes(pattern);
};

/**
 * Returns a CDN URL for a country flag image by ISO 3166-1 alpha-2 code.
 */
const getFlagImageUrl = (countryCode: string): string => {
  const cc = countryCode.toLowerCase();
  return `https://flagcdn.com/w20/${cc}.png`;
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
 * in mod pages: size/font/center/list/url/img/color/bold/italic/underline.
 */
const renderNexusDescription = (raw: string): string => {
  let html = raw;

  // Basic formatting tags
  html = replaceRepeatedly(html, /\[b\](.*?)\[\/b\]/gis, '<strong>$1</strong>');
  html = replaceRepeatedly(html, /\[i\](.*?)\[\/i\]/gis, '<em>$1</em>');
  html = replaceRepeatedly(html, /\[u\](.*?)\[\/u\]/gis, '<u>$1</u>');
  html = replaceRepeatedly(html, /\[center\](.*?)\[\/center\]/gis, '<div class="bb-center">$1</div>');

  // Font tags: keep user-visible text and apply only a restricted font-family.
  html = replaceRepeatedly(html, /\[font=(.*?)\](.*?)\[\/font\]/gis, (_m, font, text) => {
    const safeFont = sanitizeFontFamily(font);
    return safeFont
      ? `<span style="font-family:${safeFont}">${text}</span>`
      : String(text);
  });

  // Color tags
  html = replaceRepeatedly(html, /\[color=(.*?)\](.*?)\[\/color\]/gis, (_m, color, text) => {
    const safeColor = sanitizeColor(color);
    return safeColor
      ? `<span style="color:${safeColor}">${text}</span>`
      : String(text);
  });

  // URL tags
  html = replaceRepeatedly(html, /\[url=(.*?)\](.*?)\[\/url\]/gis, (_m, href, text) => {
    const safeHref = sanitizeExternalUrl(href);
    return safeHref
      ? `<a href="${safeHref}" target="_blank" rel="noreferrer">${text}</a>`
      : String(text);
  });
  html = replaceRepeatedly(html, /\[url\](.*?)\[\/url\]/gis, (_m, href) => {
    const safeHref = sanitizeExternalUrl(href);
    return safeHref
      ? `<a href="${safeHref}" target="_blank" rel="noreferrer">${safeHref}</a>`
      : String(href);
  });

  // Image tags
  html = replaceRepeatedly(html, /\[img\](.*?)\[\/img\]/gis, (_m, src) => {
    const safeSrc = sanitizeExternalImageUrl(src);
    return safeSrc
      ? `<img class="bb-inline-image" src="${safeSrc}" alt="mod description image" loading="lazy" />`
      : '';
  });

  // Size tags (map Nexus size scale to simple em values)
  html = replaceRepeatedly(html, /\[size=(\d+)\](.*?)\[\/size\]/gis, (_m, size, text) => {
    const n = Number(size);
    const clamped = Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 3;
    const em = 0.8 + clamped * 0.1;
    return `<span style="font-size:${em.toFixed(2)}em">${text}</span>`;
  });

  // Some Nexus descriptions contain broken nested size tags with missing
  // closing pairs. Strip any residual raw size/font markers instead of
  // leaking BBCode into the UI.
  html = html.replace(/\[size=\d+\]/gi, '');
  html = html.replace(/\[\/size\]/gi, '');
  html = html.replace(/\[font=.*?\]/gi, '');
  html = html.replace(/\[\/font\]/gi, '');

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

  // Treat single raw line breaks as soft wraps and preserve only paragraph
  // boundaries. Nexus descriptions often contain hard-wrapped source text,
  // and converting every `\n` to `<br />` produces visibly noisy layout.
  html = normalizeDescriptionLineBreaks(html);

  return html;
};

/**
 * Normalizes raw description whitespace into readable HTML line breaks.
 *
 * Rules:
 * - Existing `<br />` tags are preserved.
 * - Single newline characters become spaces.
 * - Two or more consecutive newlines become paragraph breaks.
 * - Redundant `<br />` around block-level elements are removed.
 */
const normalizeDescriptionLineBreaks = (value: string): string => {
  let normalized = value.replace(/\r\n|\r/g, '\n');

  normalized = normalized.replace(/[ \t]*\n[ \t]*/g, '\n');
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  normalized = normalized.replace(/\n\n/g, '__BB_PARAGRAPH_BREAK__');
  normalized = normalized.replace(/\n/g, ' ');
  normalized = normalized.replace(/__BB_PARAGRAPH_BREAK__/g, '<br /><br />');

  normalized = normalized.replace(/(?:<br \/>\s*){3,}/gi, '<br /><br />');
  normalized = normalized.replace(/<br \/>\s*(<(?:div|ul|ol|li|img)\b)/gi, '$1');
  normalized = normalized.replace(/(<\/(?:div|ul|ol|li)>)(?:\s*<br \/>)+/gi, '$1');

  return normalized;
};

/**
 * Re-applies a BBCode replacement until the string stops changing.
 *
 * Nexus descriptions sometimes contain nested tags, while a single regex pass
 * only resolves the innermost pair. Repeating the replacement keeps the logic
 * simple and is sufficient for the short description payloads used here.
 */
const replaceRepeatedly = (
  value: string,
  pattern: RegExp,
  replacement: string | ((substring: string, ...args: string[]) => string),
): string => {
  let current = value;

  for (let i = 0; i < 10; i += 1) {
    const next = current.replace(pattern, replacement as never);
    if (next === current) {
      break;
    }
    current = next;
  }

  return current;
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

/**
 * Allows a limited set of safe CSS font-family values for BBCode [font].
 */
const sanitizeFontFamily = (value: string): string | null => {
  const family = String(value).trim();
  if (!family) return null;

  // Allow only letters, numbers, spaces, commas, apostrophes and hyphens.
  if (!/^[a-z0-9 ,'-]+$/i.test(family)) {
    return null;
  }

  const normalized = family.toLowerCase();
  const blocked = ['expression', 'javascript', 'url(', '@import', ';', ':', '/*', '*/'];
  if (blocked.some((token) => normalized.includes(token))) {
    return null;
  }

  return family;
};
