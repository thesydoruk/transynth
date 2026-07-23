import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  voiceAudioUrl,
  voiceRegeneratePreviewUrl,
  voiceTranslationAudioUrl,
  type VoiceLinePreview,
} from '../../../../../api';
import { compareTrackKey, type CompareTrack } from '../compareTrack';

export const useVoiceRegenerateComparePlayback = (
  modId: number,
  line: VoiceLinePreview,
  sessionId: string,
) => {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setPlayingTrack(null);
    setLoadingTrack(null);
  }, []);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const handlePlay = useCallback(
    async (track: CompareTrack) => {
      const trackKey = compareTrackKey(track);
      if (playingTrack === trackKey) {
        stopPlayback();
        return;
      }

      stopPlayback();
      setError(null);
      setLoadingTrack(trackKey);

      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;

      const url =
        track.kind === 'source'
          ? voiceAudioUrl(modId, line.formidLower6, line.variant)
          : track.kind === 'current'
            ? `${voiceTranslationAudioUrl(modId, line.formidLower6, line.variant)}?t=${Date.now()}`
            : `${voiceRegeneratePreviewUrl(modId, sessionId, track.preview.id)}?t=${Date.now()}`;

      audio.src = url;

      const onCanPlay = () => {
        setLoadingTrack(null);
        setPlayingTrack(trackKey);
        void audio.play().catch((err: unknown) => {
          setError(err instanceof Error ? err.message : t('modEditor.voicePlayError'));
          setPlayingTrack(null);
        });
      };

      const onEnded = () => setPlayingTrack(null);
      const onAudioError = () => {
        setLoadingTrack(null);
        setPlayingTrack(null);
        setError(t('modEditor.voicePlayError'));
      };

      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onAudioError, { once: true });
      audio.load();
    },
    [line.formidLower6, line.variant, modId, playingTrack, sessionId, stopPlayback, t],
  );

  return {
    playingTrack,
    loadingTrack,
    error,
    setError,
    handlePlay,
    stopPlayback,
  };
};
