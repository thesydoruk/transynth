import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpeakerGender, VoiceSpeakerSummary } from '../../../../../../api';
import { ProgressPill } from '../../../DialogsMode/components/ProgressPill';
import styles from './VoiceNavigator.module.scss';

const GENDER_SYMBOL: Record<SpeakerGender, string> = {
  male: '♂',
  female: '♀',
  any: '⚥',
  unknown: '',
};

export interface VoiceSpeakerRowProps {
  speaker: VoiceSpeakerSummary;
  active: boolean;
  onSelect: (key: string) => void;
}

/** One selectable speaker with dubbing progress. */
export const VoiceSpeakerRow = memo(({ speaker, active, onSelect }: VoiceSpeakerRowProps) => {
  const { t } = useTranslation();
  const dubbableCount = speaker.lineCount - speaker.orphanCount;

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
        <span className={styles.rowLines}>{speaker.lineCount}</span>
      </span>
      <span className={styles.rowBottom}>
        <ProgressPill
          done={speaker.dubbedCount}
          total={dubbableCount}
          showCount
          title={
            speaker.orphanCount > 0
              ? `${t('voice.dubbedProgress', {
                  done: speaker.dubbedCount,
                  total: dubbableCount,
                })} · ${t('voice.orphanLines', { count: speaker.orphanCount })}`
              : t('voice.dubbedProgress', {
                  done: speaker.dubbedCount,
                  total: dubbableCount,
                })
          }
        />
      </span>
    </button>
  );
});

VoiceSpeakerRow.displayName = 'VoiceSpeakerRow';
