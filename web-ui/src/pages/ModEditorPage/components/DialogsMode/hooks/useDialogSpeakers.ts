import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DialogSpeaker, type SpeakerGender } from '../../../../../api';

export interface UseDialogSpeakersParams {
  modId: number;
  /** Transcript to refetch after an override, because QA re-runs server-side. */
  transcriptQueryKey: readonly unknown[];
}

/**
 * Speakers of the open mod and the manual gender override for each of them.
 *
 * Loaded once per mod and shared by every entry of the transcript: gender is a
 * property of the speaker, not of the line, so one list answers the question
 * for the whole conversation.
 */
export const useDialogSpeakers = ({ modId, transcriptQueryKey }: UseDialogSpeakersParams) => {
  const qc = useQueryClient();
  const speakersQueryKey = useMemo(() => ['dialog-speakers', modId], [modId]);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const speakersQuery = useQuery({
    queryKey: speakersQueryKey,
    queryFn: () => api.dialogs.speakers(modId),
    staleTime: 5 * 60_000,
  });

  const byKey = useMemo(() => {
    const map = new Map<string, DialogSpeaker>();
    for (const speaker of speakersQuery.data ?? []) map.set(speaker.speaker_key, speaker);
    return map;
  }, [speakersQuery.data]);

  const setGender = useCallback(
    async (speakerKey: string, gender: SpeakerGender | null) => {
      setPendingKeys((prev) => new Set(prev).add(speakerKey));
      setError(null);
      try {
        const updated = await api.dialogs.setSpeakerGender(modId, speakerKey, gender);
        qc.setQueryData<DialogSpeaker[]>(speakersQueryKey, (prev) =>
          prev?.map((speaker) => (speaker.speaker_key === speakerKey ? updated : speaker)),
        );
        await qc.invalidateQueries({ queryKey: transcriptQueryKey as unknown[] });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(speakerKey);
          return next;
        });
      }
    },
    [modId, qc, speakersQueryKey, transcriptQueryKey],
  );

  return {
    byKey,
    setGender,
    pendingKeys,
    error,
    dismissError: useCallback(() => setError(null), []),
  };
};

/** Return type of {@link useDialogSpeakers}. */
export type DialogSpeakers = ReturnType<typeof useDialogSpeakers>;
