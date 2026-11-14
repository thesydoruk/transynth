import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Mod } from '../../../api';
import { ModWorkspaceList } from '../ModWorkspaceList';
import { useModsWorkspace } from '../ModsWorkspaceContext';
import { groupModVersions } from '../modVersions';
import { groupMods, sortModsByName, type ModsGroupBy } from '../modsView';
import s from './ModsSections.module.scss';

type ModsSectionProps = {
  mods: Mod[];
  group: ModsGroupBy;
};

/** Everything that is not official game content, optionally grouped by source or status. */
export const ModsSection = ({ mods, group }: ModsSectionProps) => {
  const { t } = useTranslation();
  const { vortexGroupLabel } = useModsWorkspace();

  const groups = useMemo(() => {
    const labelOf = (key: string): string => {
      if (group === 'status') return t(`mods.view.status.${key}`);
      if (key === 'manual') return t('mods.view.source.manual');
      return vortexGroupLabel(Number(key)) ?? t('mods.vortexChip');
    };
    return groupMods(sortModsByName(mods), group, labelOf);
  }, [mods, group, vortexGroupLabel, t]);
  if (mods.length === 0) return null;

  return (
    <section className={s.section}>
      <h2 className={s.sectionTitle}>
        {t('mods.sections.modsTitle', { count: groupModVersions(mods).length })}
      </h2>
      {groups.map((bucket) => (
        <div key={bucket.key} className={s.group}>
          {group !== 'none' && (
            <h3 className={s.groupTitle}>
              {bucket.label} · {groupModVersions(bucket.mods).length}
            </h3>
          )}
          <div className={s.list}>
            <ModWorkspaceList mods={bucket.mods} />
          </div>
        </div>
      ))}
    </section>
  );
};
