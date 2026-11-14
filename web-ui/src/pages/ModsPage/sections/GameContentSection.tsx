import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Mod } from '../../../api';
import { ProgressBar } from '../../../components/StatusBadge';
import { ModWorkspaceList } from '../ModWorkspaceList';
import { groupModVersions } from '../modVersions';
import { aggregateProgress, sortGameContent, splitAddons } from '../modsView';
import s from './ModsSections.module.scss';

/** The game itself and its DLC, with official add-ons folded away at the bottom. */
export const GameContentSection = ({ mods }: { mods: Mod[] }) => {
  const { t } = useTranslation();
  const { core, addons } = useMemo(() => splitAddons(sortGameContent(mods)), [mods]);
  if (mods.length === 0) return null;

  const { stats } = aggregateProgress(mods);
  return (
    <details className={s.section} open>
      <summary className={s.summary}>
        <span>{t('mods.sections.gameTitle', { count: groupModVersions(mods).length })}</span>
        <span className={s.summaryBar}>
          <ProgressBar stats={stats} />
        </span>
      </summary>
      <div className={s.list}>
        <ModWorkspaceList mods={core} />
      </div>
      {addons.length > 0 && (
        <details className={s.nested}>
          <summary className={s.summary}>
            {t('mods.sections.addonsTitle', { count: groupModVersions(addons).length })}
          </summary>
          <div className={s.list}>
            <ModWorkspaceList mods={addons} />
          </div>
        </details>
      )}
    </details>
  );
};
