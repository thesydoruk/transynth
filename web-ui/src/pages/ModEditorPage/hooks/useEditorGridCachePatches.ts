import { useCallback } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { type StringRow, type StringsResult } from '../../../api';
import type { ContextMenuStatus } from '../statusFilter';

/**
 * Optimistic patches for loaded infinite-scroll string-grid pages.
 */
export function useEditorGridCachePatches(modId: number) {
  const qc = useQueryClient();

  const patchClearedInCache = useCallback(
    (matchRow: (row: StringRow) => boolean) => {
      qc.setQueriesData<InfiniteData<StringsResult>>({ queryKey: ['strings', modId] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            rows: page.rows.map((r) =>
              matchRow(r)
                ? {
                    ...r,
                    translation: null,
                    translation_id: null,
                    status: null,
                    qa_issue_count: 0,
                  }
                : r,
            ),
          })),
        };
      });
    },
    [qc, modId],
  );

  const patchSkipInCache = useCallback(
    (matchRow: (row: StringRow) => boolean, skip: boolean) => {
      qc.setQueriesData<InfiniteData<StringsResult>>({ queryKey: ['strings', modId] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            rows: page.rows.map((r) =>
              matchRow(r)
                ? skip
                  ? {
                      ...r,
                      is_ignored: true,
                      status: 'skip' as const,
                      translation: null,
                      translation_id: null,
                      qa_issue_count: 0,
                    }
                  : {
                      ...r,
                      is_ignored: false,
                      status: null,
                    }
                : r,
            ),
          })),
        };
      });
    },
    [qc, modId],
  );

  const patchStatusInCache = useCallback(
    (matchRow: (row: StringRow) => boolean, status: ContextMenuStatus) => {
      qc.setQueriesData<InfiniteData<StringsResult>>({ queryKey: ['strings', modId] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            rows: page.rows.map((r) =>
              matchRow(r) && r.translation ? { ...r, status, is_ignored: false } : r,
            ),
          })),
        };
      });
    },
    [qc, modId],
  );

  return { patchClearedInCache, patchSkipInCache, patchStatusInCache };
}
