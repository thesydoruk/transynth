import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { StringRow } from '../../../../api';
import { api } from '../../../../api';
import styles from './VideoPhrasePanel.module.scss';

export interface VideoPhrasePanelProps {
  modId: number;
  activeRow: StringRow;
}

const clock = (seconds: number): string => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * The players of a VIDEO record: the phrase as the actor spoke it (a slice of
 * the separated speech track) and, once the video is dubbed, the take in the
 * dub, from the phrase's start to the next phrase.
 */
export const VideoPhrasePanel = ({ modId, activeRow }: VideoPhrasePanelProps) => {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['video-phrase', modId, activeRow.string_id],
    queryFn: () => api.video.phrase(modId, activeRow.string_id),
    staleTime: 30_000,
    retry: false,
  });
  if (isLoading || !data) return null;

  const dubTo = data.nextStartS ?? data.durationS ?? data.endS + 5;
  return (
    <div className={styles.panel}>
      <span className={styles.timing}>
        {clock(data.startS)}–{clock(data.endS)}
      </span>
      {data.hasSpeech && (
        <audio
          controls
          preload="none"
          className={styles.player}
          src={api.video.audioUrl(modId, data.videoId, 'speech', {
            from: data.startS,
            to: data.endS,
          })}
          aria-label={t('modEditor.videoPhraseOriginal')}
        />
      )}
      {data.hasDub ? (
        <audio
          controls
          preload="none"
          className={styles.player}
          src={api.video.audioUrl(modId, data.videoId, 'dub', { from: data.startS, to: dubTo })}
          aria-label={t('modEditor.videoPhraseDub')}
        />
      ) : (
        <span className={styles.note}>{t('modEditor.videoPhraseNoDub')}</span>
      )}
      {data.overrun && <span className={styles.overrun}>{t('video.segments.overrun')}</span>}
    </div>
  );
};
