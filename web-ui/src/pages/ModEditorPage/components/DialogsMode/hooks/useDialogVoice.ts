import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  api,
  voiceAudioUrl,
  voiceTranslationAudioUrl,
  type DialogEntry,
  type DialogLine,
} from '../../../../../api';
import { useAudioTrack } from '../../../../../hooks/useAudioTrack';

/** Which take of a line is played: the one shipped with the mod, or the dub. */
export type VoiceTrackKind = 'source' | 'translation';

/** Playback state of one dialog line that has audio on disk. */
export interface DialogLineVoice {
  hasSource: boolean;
  hasTranslation: boolean;
  /** Take of this line that is currently sounding. */
  playing: VoiceTrackKind | null;
  /** Take of this line that is still being fetched. */
  loading: VoiceTrackKind | null;
  play: (kind: VoiceTrackKind) => void;
}

/**
 * Address of a voice asset: the lower six hex digits of the INFO FormID plus
 * the position of the line inside that record, mirroring `<FormID>_<n>.fuz`.
 */
const audioRef = (
  entry: DialogEntry,
  line: DialogLine,
): { formidLower6: string; variant: number; key: string } | null => {
  if (line.voice_variant === null || !entry.info_formid_hex) return null;
  const formidLower6 = entry.info_formid_hex.slice(2).toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(formidLower6)) return null;
  return {
    formidLower6,
    variant: line.voice_variant,
    key: `${formidLower6}:${line.voice_variant}`,
  };
};

const kindOf = (trackKey: string | null, key: string): VoiceTrackKind | null =>
  trackKey === `source:${key}`
    ? 'source'
    : trackKey === `translation:${key}`
      ? 'translation'
      : null;

/**
 * Voice-over playback for the dialogs editor.
 *
 * The set of playable lines is read once per mod, because knowing whether a
 * line is voiced means scanning the mod's `Sound/Voice` tree on the server —
 * far too costly to repeat per line. Lines without audio get no controls at
 * all, so a mod that ships none looks exactly as it did before.
 */
export const useDialogVoice = (modId: number, targetLang: string) => {
  const { t } = useTranslation();
  const track = useAudioTrack();
  const { play, setError } = track;

  const query = useQuery({
    queryKey: ['dialog-voice-availability', modId, targetLang],
    queryFn: () => api.mods.voiceAvailability(modId, targetLang),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const available = useMemo(() => {
    const data = query.data;
    if (!data?.ok) return null;
    return { source: new Set(data.source), translation: new Set(data.translation) };
  }, [query.data]);

  const voiceFor = useCallback(
    (entry: DialogEntry, line: DialogLine): DialogLineVoice | null => {
      if (!available) return null;
      const ref = audioRef(entry, line);
      if (!ref) return null;

      const hasSource = available.source.has(ref.key);
      const hasTranslation = available.translation.has(ref.key);
      if (!hasSource && !hasTranslation) return null;

      return {
        hasSource,
        hasTranslation,
        playing: kindOf(track.playingKey, ref.key),
        loading: kindOf(track.loadingKey, ref.key),
        play: (kind) =>
          play(
            `${kind}:${ref.key}`,
            kind === 'source'
              ? voiceAudioUrl(modId, ref.formidLower6, ref.variant)
              : // Regenerating a take overwrites the file, so bypass the HTTP cache.
                `${voiceTranslationAudioUrl(modId, ref.formidLower6, ref.variant)}?t=${Date.now()}`,
            kind === 'source'
              ? t('modEditor.voicePlayError')
              : t('modEditor.voicePlayTranslationError'),
          ),
      };
    },
    [available, modId, play, t, track.loadingKey, track.playingKey],
  );

  return {
    voiceFor,
    error: track.error,
    clearError: useCallback(() => setError(null), [setError]),
  };
};
