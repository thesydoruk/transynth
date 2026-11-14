/**
 * ModsPage — one workspace for every mod of a game, wherever it came from.
 *
 * Sections: toolbar (upload, search, filters), activity, game and DLC, mods, exports.
 * The view (source, content, status, search, grouping) lives in the URL.
 *
 * URL: /games/:gameId
 */
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Mod } from '../../api';
import { useContentLangs } from '../../hooks/useContentLangs';
import { useModAiJobsPoll } from '../../hooks/useModAiJobsPoll';
import { DEFAULT_GAME_ID } from '../../langDefaults';
import { ModListHeader } from './ModListHeader';
import { ModsPageEmptyState } from './ModsPageEmptyState';
import { ModsPageModals } from './ModsPageModals';
import { ModsWorkspaceContext } from './ModsWorkspaceContext';
import { useGameInfo, useModsPageData, useModsView, useModsWorkspaceState } from './hooks';
import { countActivity } from './modsPageUtils';
import { filterMods, splitByContent } from './modsView';
import { ActivitySection } from './sections/ActivitySection';
import { ExportsSection } from './sections/ExportsSection';
import { GameHeader } from './sections/GameHeader';
import { GameLinks } from './sections/GameLinks';
import { GameUnavailable } from './sections/GameUnavailable';
import { GameContentSection } from './sections/GameContentSection';
import { ModsSection } from './sections/ModsSection';
import { ModsToolbar } from './sections/ModsToolbar';
import sectionS from './sections/ModsSections.module.scss';
import s from './ModsPage.module.scss';

const NO_MODS: Mod[] = [];

export const ModsPage = () => {
  const { t } = useTranslation();
  const { gameId = DEFAULT_GAME_ID } = useParams<{ gameId: string }>();
  const { srcLang, targetLang } = useContentLangs();
  useModAiJobsPoll(true);

  const gameInfo = useGameInfo(gameId);
  const { view, setView, resetFilters } = useModsView();
  const pageData = useModsPageData(gameId, srcLang, targetLang);
  const allMods = pageData.mods ?? NO_MODS;
  const visibleMods = useMemo(() => filterMods(allMods, view), [allMods, view]);
  const { game, mods } = useMemo(() => splitByContent(visibleMods), [visibleMods]);
  const workspace = useModsWorkspaceState({ gameId, srcLang, targetLang, pageData, visibleMods });

  if (gameInfo.isLoading) return <GameUnavailable state="loading" />;
  if (gameInfo.error) return <GameUnavailable state="error" error={gameInfo.error} />;
  if (!gameInfo.game) return <GameUnavailable state="missing" />;

  if (pageData.modsError) {
    return (
      <div className={s.page}>
        <div className={`${s.center} ${s.error}`}>
          {t('common.error', { message: String(pageData.modsError) })}
        </div>
      </div>
    );
  }

  const loading =
    pageData.isModsLoading && allMods.length === 0 && pageData.activeImportJobs.length === 0;
  const nothingAtAll =
    !pageData.isModsLoading &&
    allMods.length === 0 &&
    countActivity(workspace.activity) === 0 &&
    workspace.exportArchives.archives.length === 0;

  return (
    <ModsWorkspaceContext.Provider value={workspace}>
      <div className={s.page}>
        <GameHeader game={gameInfo.game} mods={allMods} />
        <GameLinks gameId={gameId} srcLang={srcLang} targetLang={targetLang} />
        <ModsToolbar view={view} onChange={setView} showFilters={allMods.length > 0} />

        {loading ? (
          <div className={s.center}>{t('mods.loadingMods')}</div>
        ) : nothingAtAll ? (
          <ModsPageEmptyState gameId={gameId} onUploadClick={workspace.upload.openFilePicker} />
        ) : (
          <>
            <ActivitySection />
            {visibleMods.length > 0 && (
              <>
                <ModListHeader />
                <GameContentSection mods={game} />
                <ModsSection mods={mods} group={view.group} />
              </>
            )}
            {allMods.length > 0 && visibleMods.length === 0 && (
              <div className={sectionS.noMatch}>
                <span>{t('mods.view.noMatch')}</span>
                <button type="button" className={sectionS.resetBtn} onClick={resetFilters}>
                  {t('mods.view.reset')}
                </button>
              </div>
            )}
            <ExportsSection />
          </>
        )}

        <ModsPageModals />
      </div>
    </ModsWorkspaceContext.Provider>
  );
};
