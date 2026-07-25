import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type DialogLine } from '../../../../../api';
import { toast } from '../../../../../components/Toast';
import { isUntranslated } from './useTranscriptView';

/** Which engine fills the blanks: translation memory or the LLM. */
export type FillMode = 'tm' | 'llm';

/** The translate endpoint is called in chunks so progress advances steadily. */
const CHUNK_SIZE = 100;

export interface UseTranscriptFillParams {
  modId: number;
  srcLang: string;
  targetLang: string;
  transcriptQueryKey: readonly unknown[];
  groupsQueryKey: readonly unknown[];
}

/**
 * Fill every untranslated line of the open dialog in one go.
 *
 * Working through a conversation usually means most lines need the same
 * treatment, so the transcript offers the same TM and LLM passes the strings
 * grid has — scoped to what is currently on screen instead of a selection.
 */
export const useTranscriptFill = ({
  modId,
  srcLang,
  targetLang,
  transcriptQueryKey,
  groupsQueryKey,
}: UseTranscriptFillParams) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inFlight = useRef(false);

  const fill = useCallback(
    async (mode: FillMode, lines: DialogLine[]) => {
      if (inFlight.current) return;

      const ids = lines.filter(isUntranslated).map((line) => line.string_id);
      if (ids.length === 0) {
        toast.info(t('dialogs.fillNothing'));
        return;
      }

      inFlight.current = true;
      setProgress({ done: 0, total: ids.length });
      let applied = 0;

      try {
        for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
          const chunk = ids.slice(offset, offset + CHUNK_SIZE);
          if (mode === 'llm') {
            const results = await api.strings.batchTranslate(
              chunk,
              srcLang,
              targetLang,
              (event) => setProgress({ done: offset + event.done, total: ids.length }),
              modId,
            );
            applied += results.filter((result) => result.text !== undefined).length;
          } else {
            const result = await api.strings.batchApplyTm(chunk, srcLang, targetLang, modId);
            applied += result.applied;
          }
          setProgress({ done: Math.min(offset + chunk.length, ids.length), total: ids.length });
        }
        toast.success(t('dialogs.fillDone', { count: applied }));
      } catch (cause) {
        toast.error(String(cause));
      } finally {
        inFlight.current = false;
        setProgress(null);
        void qc.invalidateQueries({ queryKey: transcriptQueryKey as unknown[] });
        void qc.invalidateQueries({ queryKey: groupsQueryKey as unknown[] });
      }
    },
    [modId, srcLang, targetLang, qc, transcriptQueryKey, groupsQueryKey, t],
  );

  return { fill, progress };
};
