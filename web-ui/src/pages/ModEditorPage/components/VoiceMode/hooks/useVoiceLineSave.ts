import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type VoiceLinePreview, type VoiceSpeakerLinesResponse } from '../../../../../api';
import { lineKey } from '../voiceLineKeys';

export interface UseVoiceLineSaveParams {
  modId: number;
  linesQueryKey: readonly unknown[];
  /** Refetched once a take is removed: the speaker's dubbed count changes. */
  speakersQueryKey: readonly unknown[];
  srcLang: string;
  targetLang: string;
}

/**
 * Translation edits for voice lines, patched into the speaker-lines cache.
 *
 * Mirrors {@link useDialogLineSave}: the list position and open editor stay put
 * after each blur save instead of jumping on refetch. Unlike the dialog editor,
 * clearing a line here also removes its synthesized take.
 */
export const useVoiceLineSave = ({
  modId,
  linesQueryKey,
  speakersQueryKey,
  srcLang,
  targetLang,
}: UseVoiceLineSaveParams) => {
  const qc = useQueryClient();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const patchLines = useCallback(
    (matches: (line: VoiceLinePreview) => boolean, patch: Partial<VoiceLinePreview>) => {
      qc.setQueryData<VoiceSpeakerLinesResponse>(linesQueryKey as unknown[], (prev) =>
        prev?.ok
          ? {
              ...prev,
              lines: prev.lines.map((line) => (matches(line) ? { ...line, ...patch } : line)),
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

  /**
   * Remove the line's take, then its translation. In that order a failure never
   * leaves the row claiming more than is true: if the take cannot be removed
   * nothing has changed; if the text cannot be cleared afterwards the line is
   * an ordinary undubbed one with its text, which is what the row then shows.
   */
  const clearLine = useCallback(
    (line: VoiceLinePreview) => {
      const stringId = line.stringId;
      if (stringId == null) return Promise.resolve();
      const hasText = Boolean(line.translation);
      const hasTake = Boolean(line.hasTranslationAudio);
      if (!hasText && !hasTake) return Promise.resolve();

      return run(stringId, async () => {
        if (hasTake) {
          await api.voiceTakes.removeTranslation(modId, line, srcLang, targetLang);
          const take = lineKey(line);
          patchLines((other) => lineKey(other) === take, {
            hasTranslationAudio: false,
            voiceSimilarity: null,
            canGenerateVoice: !line.ttsSkipReason && Boolean(line.translation?.trim()),
          });
          void qc.invalidateQueries({ queryKey: speakersQueryKey });
        }
        if (hasText) {
          await api.strings.clearTranslation(stringId, targetLang);
          patchLines((other) => other.stringId === stringId, {
            translation: null,
            translationId: null,
            status: null,
            canGenerateVoice: false,
          });
        }
      });
    },
    [run, modId, srcLang, targetLang, patchLines, qc, speakersQueryKey],
  );

  const saveLine = useCallback(
    (line: VoiceLinePreview, text: string) => {
      const stringId = line.stringId;
      if (stringId == null) return Promise.resolve();

      const trimmed = text.trim();
      if (trimmed === (line.translation ?? '').trim()) return Promise.resolve();
      if (trimmed === '') return clearLine(line);

      return run(stringId, async () => {
        const saved = await api.strings.saveTranslation(stringId, text, 'draft', targetLang);
        patchLines((other) => other.stringId === stringId, {
          translation: saved.text,
          translationId: saved.id,
          status: 'draft',
          canGenerateVoice:
            !line.ttsSkipReason && Boolean(saved.text.trim()) && !line.hasTranslationAudio,
        });
      });
    },
    [run, targetLang, patchLines, clearLine],
  );

  return {
    saveLine,
    clearLine,
    pendingIds,
    error,
    dismissError: () => setError(null),
  };
};

export type VoiceLineSave = ReturnType<typeof useVoiceLineSave>;
