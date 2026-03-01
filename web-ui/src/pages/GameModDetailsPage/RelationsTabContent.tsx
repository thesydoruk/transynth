import { useTranslation } from 'react-i18next';
import type { NexusModRelationItem } from '../../api';
import s from './GameModDetailsPage.module.scss';

interface RelationsTabContentProps {
  isLoading: boolean;
  error: unknown;
  emptyText: string;
  gameDomain: string;
  items: NexusModRelationItem[];
}

/** Renders one relation tab for required mods and reverse dependency lists. */
export const RelationsTabContent = ({
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
            {item.externalRequirement && <span className={s.chip}>{t('games.externalRequirement')}</span>}
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