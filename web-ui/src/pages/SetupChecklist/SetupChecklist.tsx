import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { DashboardData, SettingsPayload } from '../../api';
import s from './SetupChecklist.module.scss';

export interface SetupChecklistProps {
  dash: DashboardData | undefined;
  settings: SettingsPayload | undefined;
  /** Mods workspace for this visitor's current (or first) game. */
  workspaceTo?: string;
}

/**
 * First-run setup card. Hidden once LLM is ready, a mod is imported, and
 * auto-translate has run at least once.
 */
export const SetupChecklist = ({ dash, settings, workspaceTo }: SetupChecklistProps) => {
  const { t } = useTranslation();

  if (!dash && !settings) return null;

  const llmReady = settings == null ? true : settings.llmReadiness.canTranslate;
  const hasImportedMod = (dash?.mods.length ?? 0) > 0;
  const hasTranslations = dash?.mods.some((m) => m.translated > 0) ?? false;

  if (llmReady && hasImportedMod && hasTranslations) return null;

  const items: Array<{ done: boolean; label: string; action: string; to?: string }> = [
    {
      done: llmReady,
      label: t('setup.llmItem'),
      action: t('setup.llmAction'),
      to: '/settings?tab=llm',
    },
    {
      done: hasImportedMod,
      label: t('setup.importItem'),
      action: t('setup.importAction'),
      to: workspaceTo,
    },
    {
      done: hasTranslations,
      label: t('setup.translateItem'),
      action: t('setup.translateAction'),
      to: workspaceTo,
    },
  ];

  return (
    <section className={s.card} aria-label={t('setup.title')}>
      <h2 className={s.title}>{t('setup.title')}</h2>
      <ul className={s.list}>
        {items.map((item) => (
          <li key={item.label} className={`${s.item} ${item.done ? s.done : s.pending}`}>
            <span className={s.check} aria-hidden="true">
              {item.done ? '✓' : '○'}
            </span>
            <span className={s.label}>{item.label}</span>
            {!item.done && item.to && (
              <Link className={s.actionLink} to={item.to}>
                {item.action} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
