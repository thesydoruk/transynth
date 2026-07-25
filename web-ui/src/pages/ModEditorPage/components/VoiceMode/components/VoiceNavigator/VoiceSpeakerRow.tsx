import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpeakerGender, VoiceSpeakerGroup } from '../../../../../../api';
import { ProgressPill } from '../../../DialogsMode/components/ProgressPill';
import { speakerDubbedCount } from '../../voiceLineKeys';
import styles from './VoiceNavigator.module.scss';

const GENDER_SYMBOL: Record<SpeakerGender, string> = {
  male: '♂',
  female: '♀',
  any: '⚥',
  unknown: '',
};

export interface VoiceSpeakerRowProps {
  speaker: VoiceSpeakerGroup;
  active: boolean;
  onSelect: (key: string) => void;
}

/** One selectable speaker with dubbing progress. */
export const VoiceSpeakerRow = memo(({ speaker, active, onSelect }: VoiceSpeakerRowProps) => {
  const { t } = useTranslation();
  const dubbed = speakerDubbedCount(speaker.lines);
  const total = speaker.lines.length;

  return (
    <button
      type="button"
      className={`${styles.row} ${active ? styles.rowActive : ''}`}
      onClick={() => onSelect(speaker.key)}
      title={speaker.displayName}
    >
      <span className={styles.rowTop}>
        <span className={styles.rowLabel}>
          {speaker.referencePick && (
            <span className={styles.refMark} title={t('modEditor.voiceRefSet')}>
              ★
            </span>
          )}
          {speaker.displayName}
          {speaker.gender !== 'unknown' && (
            <span
              className={styles.gender}
              data-mismatch={speaker.genderMismatch ? '' : undefined}
              title={
                speaker.genderMismatch
                  ? t('modEditor.voiceGenderMismatch', {
                      gender: t(`dialogs.gender.${speaker.gender}`),
                    })
                  : t(`dialogs.gender.${speaker.gender}`)
              }
            >
              {' '}
              {GENDER_SYMBOL[speaker.gender]}
            </span>
          )}
        </span>
        <span className={styles.rowLines}>{total}</span>
      </span>
      <span className={styles.rowBottom}>
        <ProgressPill
          done={dubbed}
          total={total}
          showCount
          title={t('voice.dubbedProgress', { done: dubbed, total })}
        />
      </span>
    </button>
  );
});

VoiceSpeakerRow.displayName = 'VoiceSpeakerRow';
