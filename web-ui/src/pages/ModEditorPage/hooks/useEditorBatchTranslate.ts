import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import { removeAppJob, upsertAppJob } from '../../../appJobsQueue';
import { toast } from '../../../components/Toast';

const TRANSLATE_CHUNK = 100;

export interface UseEditorBatchTranslateParams {
  modId: number;
  srcLang: string;
  targetLang: string;
  refetchStats: () => void;
  resolveSelectedIds: () => Promise<number[]>;
  clearSelection: () => void;
  onDraftFilter?: () => void;
}

/**
 * Chunked LLM / TM batch translate for selected (or explicit) string IDs.
 */
export function useEditorBatchTranslate({
  modId,
  srcLang,
  targetLang,
  refetchStats,
  resolveSelectedIds,
  clearSelection,
  onDraftFilter,
}: UseEditorBatchTranslateParams) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [translateProgress, setTranslateProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const translateInFlight = useRef(false);

  const showTranslateResultToast = useCallback(
    (mode: 'llm' | 'tm', count: number) => {
      if (count > 0) {
        if (mode === 'llm') {
          toast.success(t('modEditor.translateDone', { count }), {
            action: {
              label: t('modEditor.showDraftsAction'),
              onClick: () => onDraftFilter?.(),
            },
          });
        } else {
          toast.success(t('modEditor.tmApplyDone', { count }));
        }
        return;
      }
      toast.info(mode === 'llm' ? t('modEditor.translateNone') : t('modEditor.tmApplyNone'));
    },
    [t, onDraftFilter],
  );

  const handleTranslate = useCallback(
    async (mode: 'llm' | 'tm', explicitIds?: number[]) => {
      if (translateInFlight.current) return;

      let ids: number[];
      try {
        ids = explicitIds ?? (await resolveSelectedIds());
      } catch (err) {
        toast.error(String(err));
        return;
      }
      if (ids.length === 0) return;

      translateInFlight.current = true;
      setTranslateProgress({ done: 0, total: ids.length });
      const appJobId = `${mode}-${modId}-${Date.now()}`;
      const startedAt = Date.now();
      const appJobLabel =
        mode === 'llm' ? `LLM batch translate · mod ${modId}` : `TM batch apply · mod ${modId}`;
      upsertAppJob({
        id: appJobId,
        kind: mode === 'llm' ? 'llm' : 'tm',
        label: appJobLabel,
        status: 'running',
        progress: 0,
        createdAt: startedAt,
        updatedAt: startedAt,
      });

      const updateProgress = (done: number) => {
        const progress = ids.length > 0 ? Math.round((done / ids.length) * 100) : 0;
        setTranslateProgress({ done, total: ids.length });
        upsertAppJob({
          id: appJobId,
          kind: mode === 'llm' ? 'llm' : 'tm',
          label: appJobLabel,
          status: 'running',
          progress,
          createdAt: startedAt,
          updatedAt: Date.now(),
        });
      };

      try {
        let doneCount = 0;
        for (let i = 0; i < ids.length; i += TRANSLATE_CHUNK) {
          const chunk = ids.slice(i, i + TRANSLATE_CHUNK);
          if (mode === 'llm') {
            const results = await api.strings.batchTranslate(
              chunk,
              srcLang,
              targetLang,
              (e) => updateProgress(i + e.done),
              modId,
            );
            doneCount += results.filter((r) => r.text !== undefined).length;
          } else {
            const result = await api.strings.batchApplyTm(chunk, srcLang, targetLang, modId);
            doneCount += result.applied;
          }
          updateProgress(Math.min(i + chunk.length, ids.length));
        }
        qc.invalidateQueries({ queryKey: ['strings', modId] });
        void refetchStats();
        showTranslateResultToast(mode, doneCount);
        if (!explicitIds) clearSelection();
        upsertAppJob({
          id: appJobId,
          kind: mode === 'llm' ? 'llm' : 'tm',
          label: appJobLabel,
          status: 'completed',
          progress: 100,
          createdAt: startedAt,
          updatedAt: Date.now(),
        });
        setTimeout(() => removeAppJob(appJobId), 15_000);
      } catch (err) {
        toast.error(String(err));
        upsertAppJob({
          id: appJobId,
          kind: mode === 'llm' ? 'llm' : 'tm',
          label: appJobLabel,
          status: 'failed',
          progress: null,
          error: String(err),
          createdAt: startedAt,
          updatedAt: Date.now(),
        });
      } finally {
        setTranslateProgress(null);
        translateInFlight.current = false;
      }
    },
    [
      modId,
      srcLang,
      targetLang,
      resolveSelectedIds,
      clearSelection,
      qc,
      refetchStats,
      showTranslateResultToast,
    ],
  );

  const handleBatchTranslate = useCallback(() => handleTranslate('llm'), [handleTranslate]);
  const handleBatchApplyTm = useCallback(() => handleTranslate('tm'), [handleTranslate]);
  const handleRowTranslate = useCallback(
    (row: { string_id: number }, mode: 'llm' | 'tm') => handleTranslate(mode, [row.string_id]),
    [handleTranslate],
  );

  return {
    translateProgress,
    handleBatchTranslate,
    handleBatchApplyTm,
    handleRowTranslate,
    showTranslateResultToast,
  };
}
