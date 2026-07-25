import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { voiceAudioUrl, voiceTranslationAudioUrl, type VoiceLinePreview } from '../../../../../api';
import { useAudioTrack } from '../../../../../hooks/useAudioTrack';
import { playTrackKey, type PlayKind } from '../voiceLineKeys';

/** Play the original or the generated take of a voice line in the voice modal. */
export const useVoicePlayback = (modId: number) => {
  const { t } = useTranslation();
  const track = useAudioTrack();
  const { play } = track;

  const handlePlay = useCallback(
    async (line: VoiceLinePreview, kind: PlayKind) => {
      const url =
        kind === 'source'
          ? voiceAudioUrl(modId, line.formidLower6, line.variant)
          : // Regeneration overwrites the file in place, so bypass the HTTP cache.
            `${voiceTranslationAudioUrl(modId, line.formidLower6, line.variant)}?t=${Date.now()}`;

      play(
        playTrackKey(kind, line),
        url,
        kind === 'source'
          ? t('modEditor.voicePlayError')
          : t('modEditor.voicePlayTranslationError'),
      );
    },
    [modId, play, t],
  );

  return {
    playingTrack: track.playingKey,
    loadingTrack: track.loadingKey,
    playError: track.error,
    setPlayError: track.setError,
    handlePlay,
    stopPlayback: track.stop,
  };
};
