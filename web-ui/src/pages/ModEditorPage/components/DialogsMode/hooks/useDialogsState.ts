import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DialogScope } from '../../../../../api';

/** Which lines the transcript shows. */
export type TranscriptFilter = 'all' | 'todo' | 'qa';

/** How the navigator orders its group list. */
export type GroupSort = 'label' | 'progress' | 'size';

const SCOPES: DialogScope[] = ['topics', 'branches', 'scenes', 'conversations'];
const FILTERS: TranscriptFilter[] = ['all', 'todo', 'qa'];
const SORTS: GroupSort[] = ['label', 'progress', 'size'];

const pick = <T extends string>(value: string | null, allowed: T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/**
 * Every navigation choice of the dialogs editor, mirrored into the URL.
 *
 * Keeping scope, selected group, search text, and filters in query params makes
 * the view reloadable, shareable, and reachable through browser history — the
 * previous implementation lost all of it on refresh.
 */
export const useDialogsState = () => {
  const [params, setParams] = useSearchParams();

  const patch = useCallback(
    (next: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const merged = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(next)) {
            if (value) merged.set(key, value);
            else merged.delete(key);
          }
          return merged;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const scope = pick(params.get('dscope'), SCOPES, 'topics');

  return {
    scope,
    groupKey: params.get('dkey'),
    search: params.get('dq') ?? '',
    find: params.get('dfind') ?? '',
    filter: pick(params.get('dfilter'), FILTERS, 'all'),
    sort: pick(params.get('dsort'), SORTS, 'label'),
    hideDone: params.get('ddone') === '0',

    /** Switching scope drops the selected group — keys are scope-specific. */
    setScope: (next: DialogScope) => patch({ dscope: next, dkey: null, dfind: null }),
    setGroupKey: (next: string | null) => patch({ dkey: next, dfind: null }),
    setSearch: (next: string) => patch({ dq: next }),
    setFind: (next: string) => patch({ dfind: next }),
    setFilter: (next: TranscriptFilter) => patch({ dfilter: next === 'all' ? null : next }),
    setSort: (next: GroupSort) => patch({ dsort: next === 'label' ? null : next }),
    setHideDone: (next: boolean) => patch({ ddone: next ? '0' : null }),
  };
};

/** Return type of {@link useDialogsState}. */
export type DialogsState = ReturnType<typeof useDialogsState>;
