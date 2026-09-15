import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  type DialogLine,
  type DialogScope,
  type DialogTranscript,
  type DialogTreeNode,
} from '../../../../../api';
import { bumpDialogTreeProgress } from '../dialogTreeView';
import { isUntranslated } from './useTranscriptView';

/** Statuses a reviewer can set straight from the transcript. */
export type DialogReviewStatus = 'reviewed' | 'rejected' | 'draft';

export interface UseDialogLineSaveParams {
  transcriptQueryKey: readonly unknown[];
  groupsQueryKey: readonly unknown[];
  /** Group whose progress counters follow the edit. */
  activeKey: string | null;
  activeScope: DialogScope;
  targetLang: string;
}

/**
 * Translation edits for a single dialog line, applied straight to the cache.
 *
 * Writing the result into the cached transcript instead of refetching keeps the
 * reading position, the open editor, and the keyboard cursor exactly where they
 * were — a refetch after every keystroke-sized edit made the old view jump.
 */
export const useDialogLineSave = ({
  transcriptQueryKey,
  groupsQueryKey,
  activeKey,
  activeScope,
  targetLang,
}: UseDialogLineSaveParams) => {
  const qc = useQueryClient();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const patchLine = useCallback(
    (stringId: number, patch: Partial<DialogLine>) => {
      qc.setQueryData<DialogTranscript>(transcriptQueryKey as unknown[], (prev) =>
        prev
          ? {
              ...prev,
              entries: prev.entries.map((entry) =>
                entry.lines.some((line) => line.string_id === stringId)
                  ? {
                      ...entry,
                      lines: entry.lines.map((line) =>
                        line.string_id === stringId ? { ...line, ...patch } : line,
                      ),
                    }
                  : entry,
              ),
            }
          : prev,
      );
    },
    [qc, transcriptQueryKey],
  );

  const bumpProgress = useCallback(
    (delta: number) => {
      if (delta === 0 || activeKey === null) return;
      qc.setQueryData<DialogTreeNode[]>(groupsQueryKey as unknown[], (prev) =>
        prev ? bumpDialogTreeProgress(prev, activeScope, activeKey, delta) : prev,
      );
    },
    [qc, groupsQueryKey, activeKey, activeScope],
  );

  const run = useCallback(
    async (stringId: number, action: () => Promise<void>) => {
      setPendingIds((prev) => new Set(prev).add(stringId));
      setError(null);
      try {
        await action();
        // The server re-runs QA on save, so whatever we showed for this line is stale.
        void qc.invalidateQueries({ queryKey: ['dialog-line-qa', stringId] });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(stringId);
          return next;
        });
      }
    },
    [qc],
  );

  /** Store a translation, or drop it when the text is emptied. */
  const saveLine = useCallback(
    (line: DialogLine, text: string) => {
      const trimmed = text.trim();
      if (trimmed === (line.translation ?? '').trim()) return Promise.resolve();

      return run(line.string_id, async () => {
        if (trimmed === '') {
          await api.strings.clearTranslation(line.string_id, targetLang);
          patchLine(line.string_id, { translation: null, translation_id: null, status: null });
          bumpProgress(isUntranslated(line) ? 0 : -1);
          return;
        }
        const saved = await api.strings.saveTranslation(line.string_id, text, 'draft', targetLang);
        patchLine(line.string_id, {
          translation: saved.text,
          translation_id: saved.id,
          status: 'draft',
        });
        bumpProgress(isUntranslated(line) ? 1 : 0);
      });
    },
    [run, targetLang, patchLine, bumpProgress],
  );

  /** Change the review status of an already translated line. */
  const setLineStatus = useCallback(
    (line: DialogLine, status: DialogReviewStatus) =>
      run(line.string_id, async () => {
        await api.strings.setStatus([line.string_id], status, targetLang);
        patchLine(line.string_id, { status });
      }),
    [run, targetLang, patchLine],
  );

  return { saveLine, setLineStatus, pendingIds, error, dismissError: () => setError(null) };
};

/** Return type of {@link useDialogLineSave}. */
export type DialogLineSave = ReturnType<typeof useDialogLineSave>;
