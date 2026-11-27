import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  api,
  type VoiceEffortChoice,
  type VoiceLinePreview,
  type VoiceSpeakerLinesResponse,
} from '../../../../../api';
import { patchVoiceLineEffort } from '../voiceEffort';
import { lineKey } from '../voiceLineKeys';
import type { useVoiceData } from './useVoiceData';

/**
 * Sets a line's vocal-effort tag by hand and patches the cached line with the
 * server's answer. Nothing else needs refreshing: with tags on, the line's take
 * goes stale through its version stamp, which the server recomputes on demand.
 */
export const useVoiceEffortChoice = (
  modId: number,
  {
    linesQueryKey,
    effortTagsSupported,
    effortTagsActive,
  }: Pick<
    ReturnType<typeof useVoiceData>,
    'linesQueryKey' | 'effortTagsSupported' | 'effortTagsActive'
  >,
) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ line, choice }: { line: VoiceLinePreview; choice: VoiceEffortChoice }) =>
      api.voiceEffort.setOverride(modId, line, choice),
    onMutate: () => setError(null),
    onSuccess: (effort, { line }) => {
      qc.setQueryData<VoiceSpeakerLinesResponse>(linesQueryKey, (data) =>
        patchVoiceLineEffort(data, line, effort),
      );
    },
    onError: (err) => setError(err instanceof Error ? err.message : t('voice.effort.saveError')),
  });

  return {
    /** Props for the line list; unset for a game that never tags lines. */
    effort: effortTagsSupported
      ? {
          active: effortTagsActive,
          pendingKey:
            mutation.isPending && mutation.variables ? lineKey(mutation.variables.line) : null,
          onChoose: (line: VoiceLinePreview, choice: VoiceEffortChoice) =>
            mutation.mutate({ line, choice }),
        }
      : undefined,
    error,
    dismissError: () => setError(null),
  };
};
