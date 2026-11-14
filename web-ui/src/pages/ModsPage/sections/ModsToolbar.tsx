import { useTranslation } from 'react-i18next';
import { ModsPageUploadBar } from '../ModsPageUploadBar';
import { useModsWorkspace } from '../ModsWorkspaceContext';
import type { ModsContent, ModsGroupBy, ModsStatusFilter, ModsView } from '../modsView';
import s from './ModsSections.module.scss';

type ModsToolbarProps = {
  view: ModsView;
  onChange: (patch: Partial<ModsView>) => void;
  /** The filters only make sense once there is something to filter. */
  showFilters: boolean;
};

const CONTENT: ModsContent[] = ['all', 'game', 'mods'];
const STATUS: ModsStatusFilter[] = ['all', 'todo', 'review', 'done'];
const GROUP: ModsGroupBy[] = ['none', 'source', 'status'];

/** Upload bar, then search and the view selects (source, content, status, grouping). */
export const ModsToolbar = ({ view, onChange, showFilters }: ModsToolbarProps) => {
  const { t } = useTranslation();
  const { vortexGroups } = useModsWorkspace();

  return (
    <>
      <ModsPageUploadBar />
      {showFilters && (
        <div className={s.filters}>
          <input
            type="search"
            className={s.search}
            value={view.q}
            placeholder={t('mods.view.search')}
            aria-label={t('mods.view.search')}
            onChange={(e) => onChange({ q: e.target.value })}
          />
          {vortexGroups.length > 0 && (
            <select
              className={s.select}
              aria-label={t('mods.view.sourceLabel')}
              value={String(view.source)}
              onChange={(e) => {
                const value = e.target.value;
                onChange({
                  source: value === 'all' || value === 'manual' ? value : Number(value),
                });
              }}
            >
              <option value="all">{t('mods.view.source.all')}</option>
              <option value="manual">{t('mods.view.source.manual')}</option>
              {vortexGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          )}
          <select
            className={s.select}
            aria-label={t('mods.view.contentLabel')}
            value={view.content}
            onChange={(e) => onChange({ content: e.target.value as ModsContent })}
          >
            {CONTENT.map((value) => (
              <option key={value} value={value}>
                {t(`mods.view.content.${value}`)}
              </option>
            ))}
          </select>
          <select
            className={s.select}
            aria-label={t('mods.view.statusLabel')}
            value={view.status}
            onChange={(e) => onChange({ status: e.target.value as ModsStatusFilter })}
          >
            {STATUS.map((value) => (
              <option key={value} value={value}>
                {t(`mods.view.status.${value}`)}
              </option>
            ))}
          </select>
          <select
            className={s.select}
            aria-label={t('mods.view.groupLabel')}
            value={view.group}
            onChange={(e) => onChange({ group: e.target.value as ModsGroupBy })}
          >
            {GROUP.map((value) => (
              <option key={value} value={value}>
                {t(`mods.view.group.${value}`)}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
};
