import { useTranslation } from 'react-i18next';
import type { SpeakerGender } from '../../../../../../api';
import styles from './DialogTranscriptView.module.scss';

/** Symbol shown for each gender; `any` is the player, whose gender is a runtime choice. */
const GENDER_SYMBOL: Record<SpeakerGender, string> = {
  male: '♂',
  female: '♀',
  any: '⚥',
  unknown: '?',
};

/** Values the editor offers; the empty value clears the override. */
const OVERRIDE_VALUES: readonly SpeakerGender[] = ['male', 'female', 'any'];

export interface SpeakerGenderBadgeProps {
  gender: SpeakerGender;
  /** Manual gender of this speaker, or null when detection is in charge. */
  override: SpeakerGender | null;
  /** Null for nodes with no resolvable speaker, which cannot be overridden. */
  speakerKey: string | null;
  saving: boolean;
  onChange: (speakerKey: string, gender: SpeakerGender | null) => void;
}

/**
 * Gender of a speaker, and the control that corrects it.
 *
 * Import guesses gender from the plugin and from voice folder names, both of
 * which can be wrong or missing, so the badge doubles as the editor: picking a
 * value writes an override that wins over detection everywhere downstream.
 */
export const SpeakerGenderBadge = ({
  gender,
  override,
  speakerKey,
  saving,
  onChange,
}: SpeakerGenderBadgeProps) => {
  const { t } = useTranslation();
  const label = t(`dialogs.gender.${gender}`);

  if (!speakerKey) {
    return (
      <span className={styles.genderBadge} data-gender={gender} title={label}>
        {GENDER_SYMBOL[gender]}
      </span>
    );
  }

  return (
    <span
      className={`${styles.genderBadge} ${styles.genderBadgeEditable}`}
      data-gender={gender}
      data-overridden={override ? '' : undefined}
      title={override ? t('dialogs.gender.overriddenTitle', { label }) : label}
    >
      {GENDER_SYMBOL[gender]}
      <select
        className={styles.genderSelect}
        value={override ?? ''}
        disabled={saving}
        aria-label={t('dialogs.gender.selectLabel')}
        onChange={(event) =>
          onChange(speakerKey, (event.target.value || null) as SpeakerGender | null)
        }
      >
        <option value="">{t('dialogs.gender.auto')}</option>
        {OVERRIDE_VALUES.map((value) => (
          <option key={value} value={value}>
            {t(`dialogs.gender.${value}`)}
          </option>
        ))}
      </select>
    </span>
  );
};
