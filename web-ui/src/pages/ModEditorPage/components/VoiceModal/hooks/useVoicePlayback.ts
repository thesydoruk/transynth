import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { voiceAudioUrl, voiceTranslationAudioUrl, type VoiceLinePreview } from '../../../../../api';
import { playTrackKey, type PlayKind } from '../voiceLineKeys';

export const useVoicePlayback = (modId: number) => {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

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
    async (line: VoiceLinePreview, kind: PlayKind) => {
      const track = playTrackKey(kind, line);
      if (playingTrack === track) {
        stopPlayback();
        return;
      }

      stopPlayback();
      setPlayError(null);
      setLoadingTrack(track);

      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;

      const url =
        kind === 'source'
          ? voiceAudioUrl(modId, line.formidLower6, line.variant)
          : `${voiceTranslationAudioUrl(modId, line.formidLower6, line.variant)}?t=${Date.now()}`;

      audio.src = url;

      const onCanPlay = () => {
        setLoadingTrack(null);
        setPlayingTrack(track);
        void audio.play().catch((err: unknown) => {
          setPlayError(
            err instanceof Error
              ? err.message
              : kind === 'source'
                ? t('modEditor.voicePlayError')
                : t('modEditor.voicePlayTranslationError'),
          );
          setPlayingTrack(null);
        });
      };

      const onEnded = () => {
        setPlayingTrack(null);
      };

      const onError = () => {
        setLoadingTrack(null);
        setPlayingTrack(null);
        setPlayError(
          kind === 'source'
            ? t('modEditor.voicePlayError')
            : t('modEditor.voicePlayTranslationError'),
        );
      };

      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError, { once: true });
      audio.load();
    },
    [modId, playingTrack, stopPlayback, t],
  );

  return {
    playingTrack,
    loadingTrack,
    playError,
    setPlayError,
    handlePlay,
    stopPlayback,
  };
};
