import { useTranslation } from 'react-i18next';
import type { DialogLineVoice, VoiceTrackKind } from '../../hooks/useDialogVoice';
import styles from './DialogLineRow.module.scss';

export interface VoiceButtonsProps {
  voice: DialogLineVoice;
}

/**
 * Play controls for a voiced line: the take shipped with the mod and, once it
 * has been synthesized, the dubbed one. Each button doubles as its own stop.
 */
export const VoiceButtons = ({ voice }: VoiceButtonsProps) => {
  const { t } = useTranslation();

  const button = (kind: VoiceTrackKind, label: string, title: string) => {
    const playing = voice.playing === kind;
    const loading = voice.loading === kind;
    return (
      <button
        type="button"
        className={`${styles.voiceButton} ${playing ? styles.voicePlaying : ''}`}
        onClick={() => voice.play(kind)}
        title={playing ? t('dialogs.stopPlayback') : title}
        aria-label={playing ? t('dialogs.stopPlayback') : title}
      >
        <span className={styles.voiceGlyph} aria-hidden="true">
          {loading ? '⋯' : playing ? '■' : '▶'}
        </span>
        {label}
      </button>
    );
  };

  return (
    <div className={styles.voice}>
      {voice.hasSource && button('source', t('dialogs.playSource'), t('dialogs.playSourceTitle'))}
      {voice.hasTranslation &&
        button('translation', t('dialogs.playTranslation'), t('dialogs.playTranslationTitle'))}
    </div>
  );
};
