import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type VoiceLinePreview, type VoiceSpeakerLinesResponse } from '../../../../../api';

export interface UseVoiceLineSaveParams {
  linesQueryKey: readonly unknown[];
  targetLang: string;
}

/**
 * Translation edits for voice lines, patched into the speaker-lines cache.
 *
 * Mirrors {@link useDialogLineSave}: the list position and open editor stay put
 * after each blur save instead of jumping on refetch.
 */
export const useVoiceLineSave = ({ linesQueryKey, targetLang }: UseVoiceLineSaveParams) => {
  const qc = useQueryClient();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const patchLine = useCallback(
    (stringId: number, patch: Partial<VoiceLinePreview>) => {
      qc.setQueryData<VoiceSpeakerLinesResponse>(linesQueryKey as unknown[], (prev) =>
        prev?.ok
          ? {
              ...prev,
              lines: prev.lines.map((line) =>
                line.stringId === stringId ? { ...line, ...patch } : line,
              ),
            }
          : prev,
      );
    },
    [qc, linesQueryKey],
  );

  const run = useCallback(async (stringId: number, action: () => Promise<void>) => {
    setPendingIds((prev) => new Set(prev).add(stringId));
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(stringId);
        return next;
      });
    }
  }, []);

  const saveLine = useCallback(
    (line: VoiceLinePreview, text: string) => {
      const stringId = line.stringId;
      if (stringId == null) return Promise.resolve();

      const trimmed = text.trim();
      if (trimmed === (line.translation ?? '').trim()) return Promise.resolve();

      return run(stringId, async () => {
        if (trimmed === '') {
          await api.strings.clearTranslation(stringId, targetLang);
          patchLine(stringId, {
            translation: null,
            translationId: null,
            status: null,
            canGenerateVoice: false,
          });
          return;
        }
        const saved = await api.strings.saveTranslation(stringId, text, 'draft', targetLang);
        patchLine(stringId, {
          translation: saved.text,
          translationId: saved.id,
          status: 'draft',
          canGenerateVoice:
            !line.ttsSkipReason && Boolean(saved.text.trim()) && !line.hasTranslationAudio,
        });
      });
    },
    [run, targetLang, patchLine],
  );

  return {
    saveLine,
    pendingIds,
    error,
    dismissError: () => setError(null),
  };
};

export type VoiceLineSave = ReturnType<typeof useVoiceLineSave>;
