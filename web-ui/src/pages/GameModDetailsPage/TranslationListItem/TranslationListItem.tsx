import { useTranslation } from 'react-i18next';
import type { NexusTranslationCandidate } from '../../../api';
import parentS from '../GameModDetailsPage.module.scss';
import s from './TranslationListItem.module.scss';

interface TranslationListItemProps {
  gameDomain: string;
  row: NexusTranslationCandidate;
}

/** Renders one likely-translation mod candidate in the translations tab. */
export const TranslationListItem = ({ gameDomain, row }: TranslationListItemProps) => {
  const { t } = useTranslation();

  return (
    <li className={s.translationListItem}>
      <div className={s.translationRowMain}>
        <h4 className={s.translationTitle}>{row.mod.name}</h4>
        <div className={s.translationMeta}>
          <span className={parentS.chip}>{t('games.scoreLabel', { score: row.score })}</span>
          <span className={parentS.chip}>{t('games.downloads', { count: row.mod.downloads.toLocaleString() })}</span>
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
