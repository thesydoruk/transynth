import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceEffortChoice, VoiceEffortTag } from '../../../../../api';
import { VOICE_EFFORT_CHOICES } from '../voiceEffort';
import s from '../VoiceRegenerateModal.module.scss';

type VoiceRegenerateEffortChoiceProps = {
  value: VoiceEffortChoice;
  /** The analysis's tag, named in the "auto" option. */
  autoTag: VoiceEffortTag | null;
  onChange: (choice: VoiceEffortChoice) => void;
  disabled?: boolean;
};

/** Which effort tag the next attempt is synthesized with, to compare a line with and without it. */
export const VoiceRegenerateEffortChoice = ({
  value,
  autoTag,
  onChange,
  disabled = false,
}: VoiceRegenerateEffortChoiceProps) => {
  const { t } = useTranslation();
  const name = useId();
  const autoLabel = t(`voice.effort.tag.${autoTag ?? 'none'}`);

  return (
    <div
      className={s.effortChoice}
      role="radiogroup"
      aria-label={t('voice.effort.regenerateLabel')}
    >
      <span className={s.effortChoiceLabel}>{t('voice.effort.regenerateLabel')}</span>
      {VOICE_EFFORT_CHOICES.map((choice) => (
        <label
          key={choice}
          className={`${s.effortOption} ${value === choice ? s.effortOptionChosen : ''}`}
        >
          <input
            type="radio"
            name={name}
            value={choice}
            checked={value === choice}
            disabled={disabled}
            onChange={() => onChange(choice)}
          />
          {t(`voice.effort.choice.${choice}`, { tag: autoLabel })}
        </label>
      ))}
    </div>
  );
};
