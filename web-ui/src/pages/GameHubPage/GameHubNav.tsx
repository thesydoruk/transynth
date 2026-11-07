import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import s from './GameHubPage.module.scss';

type GameHubNavProps = {
  gameId: string;
  isModsLoading: boolean;
  modCount: number;
  /** Rows in this game's reference base; null while loading. */
  referenceCount: number | null;
  /** Vortex staging folders an agent or the CLI mirrored; null while loading. */
  vortexGroupCount: number | null;
};

/** Translate / Discover / Quality / Reference / Terms — Release lives in the panel above. */
export const GameHubNav = ({
  gameId,
  isModsLoading,
  modCount,
  referenceCount,
  vortexGroupCount,
}: GameHubNavProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.navGrid}>
      <Link to={`/games/${gameId}/mods`} className={s.navCard}>
        <span className={s.navKicker}>{t('gameHub.workflowTranslate')}</span>
        <h2 className={s.navTitle}>{t('gameHub.modsWorkspaceLink')}</h2>
        <p className={s.navDesc}>{t('gameHub.modsWorkspaceDesc')}</p>
        {isModsLoading ? (
          <span className={s.navMeta}>{t('common.loading')}</span>
        ) : (
          <span className={s.navMeta}>
            {modCount ? t('gameHub.modCount', { count: modCount }) : t('gameHub.importsMetaEmpty')}
          </span>
        )}
      </Link>

      <Link to={`/games/${gameId}/nexus`} className={s.navCard}>
        <span className={s.navKicker}>{t('gameHub.workflowDiscover')}</span>
        <h2 className={s.navTitle}>{t('gameHub.nexusLink')}</h2>
        <p className={s.navDesc}>{t('gameHub.nexusDesc')}</p>
        <span className={s.navMeta}>{t('gameHub.nexusMeta')}</span>
      </Link>

      <Link to={`/games/${gameId}/coherence`} className={s.navCard}>
        <span className={s.navKicker}>{t('gameHub.workflowQuality')}</span>
        <h2 className={s.navTitle}>{t('gameHub.coherenceLink')}</h2>
        <p className={s.navDesc}>{t('gameHub.coherenceDesc')}</p>
        <span className={s.navMeta}>{t('gameHub.coherenceMeta')}</span>
      </Link>

      <Link to={`/games/${gameId}/reference`} className={s.navCard}>
        <span className={s.navKicker}>{t('gameHub.workflowReference')}</span>
        <h2 className={s.navTitle}>{t('gameHub.referenceLink')}</h2>
        <p className={s.navDesc}>{t('gameHub.referenceDesc')}</p>
        <span className={s.navMeta}>
          {referenceCount === null
            ? t('common.loading')
            : referenceCount > 0
              ? t('gameHub.referenceMeta', { count: referenceCount })
              : t('gameHub.referenceMetaEmpty')}
        </span>
      </Link>

      <Link to={`/games/${gameId}/vortex`} className={s.navCard}>
        <span className={s.navKicker}>{t('gameHub.workflowRelease')}</span>
        <h2 className={s.navTitle}>{t('gameHub.vortexLink')}</h2>
        <p className={s.navDesc}>{t('gameHub.vortexDesc')}</p>
        <span className={s.navMeta}>
          {vortexGroupCount === null
            ? t('common.loading')
            : vortexGroupCount > 0
              ? t('gameHub.vortexMeta', { count: vortexGroupCount })
              : t('gameHub.vortexMetaEmpty')}
        </span>
      </Link>

      <Link to="/glossary" className={s.navCard}>
        <span className={s.navKicker}>{t('gameHub.workflowTerms')}</span>
        <h2 className={s.navTitle}>{t('gameHub.glossaryLink')}</h2>
        <p className={s.navDesc}>{t('gameHub.glossaryDesc')}</p>
        <span className={s.navMeta}>{t('gameHub.glossaryMeta')}</span>
      </Link>
    </div>
  );
};
