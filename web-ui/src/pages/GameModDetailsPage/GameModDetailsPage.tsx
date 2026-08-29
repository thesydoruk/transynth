/**
 * GameModDetailsPage — detailed Nexus mod view.
 *
 * Route: /games/:gameId/nexus/:modId
 */

import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NexusApiKeyNotice } from '../../components/NexusApiKeyNotice/NexusApiKeyNotice';
import { ModFilesSection } from './components/ModFilesSection/ModFilesSection';
import { ModInfoSection } from './components/ModInfoSection';
import { RelationsTabs } from './components/RelationsTabs/RelationsTabs';
import { useGameModDetailsQueries } from './hooks/useGameModDetailsQueries';
import { useModFileActions } from './hooks/useModFileActions';
import { useNexusDownloadQueue } from './hooks/useNexusDownloadQueue';
import s from './GameModDetailsPage.module.scss';

export const GameModDetailsPage = () => {
  const { t } = useTranslation();
  const { gameId = '', modId = '' } = useParams<{ gameId: string; modId: string }>();
  const numericModId = Number(modId);
  const nexusDownloads = useNexusDownloadQueue();

  const {
    game,
    isGamesLoading,
    gamesError,
    isNexusConfigLoading,
    nexusConfigKnown,
    nexusConfigured,
    details,
    isDetailsLoading,
    detailsError,
    translations,
    isTranslationsLoading,
    translationsError,
    relations,
    isRelationsLoading,
    relationsError,
  } = useGameModDetailsQueries(gameId, numericModId);

  const {
    fileActionError,
    fileActionInfo,
    busyActionKey,
    downloadJobMap,
    handleFileDownload,
    handleFileImport,
  } = useModFileActions(gameId, numericModId, nexusDownloads);

  if (isGamesLoading) return <div className={s.loading}>{t('common.loading')}</div>;
  if (gamesError)
    return <div className={s.error}>{t('common.error', { message: String(gamesError) })}</div>;

  if (!game || !Number.isFinite(numericModId) || numericModId <= 0) {
    return (
      <div className={s.page}>
        <Link to="/" className={s.backLink}>
          {t('games.backToGames')}
        </Link>
        <h1 className={s.title}>{t('games.notFoundTitle')}</h1>
        <p className={s.subtitle}>{t('games.notFoundSubtitle')}</p>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.header}>
        <Link to={`/games/${gameId}/nexus`} className={s.backLink}>
          {t('games.backToMods')}
        </Link>
        <h1 className={s.title}>{details?.mod.name ?? t('common.loading')}</h1>
        <p className={s.subtitle}>{t('games.modIdLabel', { modId: numericModId })}</p>
      </div>

      {isNexusConfigLoading && <div className={s.loading}>{t('common.loading')}</div>}

      {nexusConfigKnown && !nexusConfigured && <NexusApiKeyNotice />}

      {nexusConfigured && detailsError && (
        <div className={s.error}>{t('common.error', { message: String(detailsError) })}</div>
      )}
      {nexusConfigured && isDetailsLoading && (
        <div className={s.loading}>{t('common.loading')}</div>
      )}

      {nexusConfigured && details && (
        <>
          <ModInfoSection details={details} />
          <ModFilesSection
            files={details.files}
            fileActionError={fileActionError}
            fileActionInfo={fileActionInfo}
            busyActionKey={busyActionKey}
            downloadJobMap={downloadJobMap}
            onDownload={(file) => void handleFileDownload(file)}
            onImport={(file) => void handleFileImport(file)}
          />
        </>
      )}

      <RelationsTabs
        gameDomain={game.domainName}
        translations={translations}
        isTranslationsLoading={isTranslationsLoading}
        translationsError={translationsError}
        relations={relations}
        isRelationsLoading={isRelationsLoading}
        relationsError={relationsError}
      />
    </div>
  );
};
