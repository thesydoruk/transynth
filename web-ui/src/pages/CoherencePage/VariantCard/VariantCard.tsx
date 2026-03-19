import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { CoherenceEntry } from '../../../api';
import s from './VariantCard.module.scss';

export interface VariantCardProps {
  translation: string;
  strings: CoherenceEntry[];
  onApply: (translation: string) => void;
  isApplying: boolean;
}

/**
 * Displays one translation variant within a coherence group and lets the user
 * apply this variant to all conflicting strings in the same group.
 */
export const VariantCard = ({ translation, strings, onApply, isApplying }: VariantCardProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.variant}>
      <div className={s.variantHeader}>
        <span className={s.variantText}>{translation}</span>
        <button
          className={s.applyBtn}
          disabled={isApplying}
          onClick={() => onApply(translation)}
          title={t('coherence.applyToAllTitle')}
        >
          {t('coherence.applyToAll')}
        </button>
      </div>
      <div className={s.variantStrings}>
        {strings.map((entry) => (
          <span key={entry.string_id} className={s.variantString}>
            <span className={s.modName}>{entry.mod_name}</span>
            {entry.edid && <span className={s.edidTag}>{entry.edid}</span>}
            <span>{entry.signature}{entry.path_simplified ? ` › ${entry.path_simplified}` : ''}</span>
            <span>({entry.status})</span>
            <Link
              className={s.openLink}
              to={`/games/${entry.mod_game}/mods/${entry.mod_id}?status=${encodeURIComponent(entry.status)}&signature=${encodeURIComponent(entry.signature)}`}
              title={t('coherence.openInEditor')}
            >
              ↗
            </Link>
          </span>
        ))}
      </div>
    </div>
  );
};
