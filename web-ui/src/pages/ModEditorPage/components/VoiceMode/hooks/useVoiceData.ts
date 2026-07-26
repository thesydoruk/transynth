import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../../api';

export const voiceSpeakersQueryKey = (modId: number, srcLang: string, targetLang: string) =>
  ['voice-speakers', modId, srcLang, targetLang] as const;

export const voiceSpeakerLinesQueryKey = (
  modId: number,
  speakerKey: string | null,
  srcLang: string,
  targetLang: string,
) => ['voice-speaker-lines', modId, speakerKey, srcLang, targetLang] as const;

export interface UseVoiceDataParams {
  modId: number;
  speakerKey: string | null;
  search: string;
  srcLang: string;
  targetLang: string;
}

/**
 * Speakers load first; lines for the selected speaker load in a second request.
 * The backend caches the filesystem scan briefly between the two calls.
 */
export const useVoiceData = ({
  modId,
  speakerKey,
  search,
  srcLang,
  targetLang,
}: UseVoiceDataParams) => {
  const speakersQuery = useQuery({
    queryKey: voiceSpeakersQueryKey(modId, srcLang, targetLang),
    queryFn: () => api.mods.voiceSpeakers(modId, srcLang, targetLang),
    staleTime: 60_000,
  });

  const speakers = useMemo(
    () => (speakersQuery.data?.ok ? speakersQuery.data.speakers : []),
    [speakersQuery.data],
  );

  const visibleSpeakers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return speakers;
    return speakers.filter((speaker) => speaker.displayName.toLowerCase().includes(query));
  }, [speakers, search]);

  const activeKey =
    (speakerKey && speakers.some((speaker) => speaker.key === speakerKey) ? speakerKey : null) ??
    visibleSpeakers[0]?.key ??
    null;

  const activeSpeaker = speakers.find((speaker) => speaker.key === activeKey) ?? null;

  const linesQuery = useQuery({
    queryKey: voiceSpeakerLinesQueryKey(modId, activeKey, srcLang, targetLang),
    queryFn: () => api.mods.voiceSpeakerLines(modId, activeKey!, srcLang, targetLang),
    enabled: activeKey !== null,
    staleTime: 30_000,
  });

  const lines = useMemo(
    () => (linesQuery.data?.ok ? linesQuery.data.lines : []),
    [linesQuery.data],
  );

  return {
    speakersQuery,
    linesQuery,
    speakers,
    visibleSpeakers,
    activeKey,
    activeSpeaker,
    lines,
    speakersQueryKey: voiceSpeakersQueryKey(modId, srcLang, targetLang),
    linesQueryKey: voiceSpeakerLinesQueryKey(modId, activeKey, srcLang, targetLang),
  };
};
