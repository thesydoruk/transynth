import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type DialogGroup, type DialogScope } from '../../../../../api';
import type { GroupSort } from './useDialogsState';

export interface UseDialogsDataParams {
  modId: number;
  scope: DialogScope;
  /** Group key requested by the URL, if any. */
  groupKey: string | null;
  search: string;
  sort: GroupSort;
  hideDone: boolean;
  srcLang: string;
  targetLang: string;
}

const percent = (group: DialogGroup) =>
  group.line_count === 0 ? 1 : group.translated_count / group.line_count;

const isDone = (group: DialogGroup) =>
  group.line_count > 0 && group.translated_count >= group.line_count;

const comparators: Record<GroupSort, (a: DialogGroup, b: DialogGroup) => number> = {
  label: (a, b) => a.label.localeCompare(b.label),
  progress: (a, b) => percent(a) - percent(b) || a.label.localeCompare(b.label),
  size: (a, b) => b.line_count - a.line_count || a.label.localeCompare(b.label),
};

/**
 * Group list and transcript of the dialogs editor.
 *
 * The group list arrives complete, so search, sort, and the "hide finished"
 * toggle run in memory and stay instant while typing. The transcript of the
 * selected group is fetched separately and is the only request that repeats
 * while the user works.
 */
export const useDialogsData = ({
  modId,
  scope,
  groupKey,
  search,
  sort,
  hideDone,
  srcLang,
  targetLang,
}: UseDialogsDataParams) => {
  const groupsQueryKey = ['dialog-groups', modId, scope, srcLang, targetLang] as const;

  const groupsQuery = useQuery({
    queryKey: groupsQueryKey,
    queryFn: () => api.dialogs.groups(modId, scope, srcLang, targetLang),
    staleTime: 60_000,
  });

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);

  const visibleGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = groups.filter((group) => {
      if (hideDone && isDone(group)) return false;
      if (!needle) return true;
      return (
        group.label.toLowerCase().includes(needle) ||
        (group.sublabel?.toLowerCase().includes(needle) ?? false)
      );
    });
    return matched.sort(comparators[sort]);
  }, [groups, search, sort, hideDone]);

  /*
   * A key coming from the URL wins as long as it still exists, so a deep link
   * survives a reload even when the current filters would hide the group.
   */
  const activeKey =
    (groupKey && groups.some((group) => group.key === groupKey) ? groupKey : null) ??
    visibleGroups[0]?.key ??
    null;

  const activeGroup = groups.find((group) => group.key === activeKey) ?? null;

  const transcriptQueryKey = [
    'dialog-transcript',
    modId,
    scope,
    activeKey,
    srcLang,
    targetLang,
  ] as const;

  const transcriptQuery = useQuery({
    queryKey: transcriptQueryKey,
    queryFn: () => api.dialogs.transcript(modId, scope, activeKey!, srcLang, targetLang),
    enabled: activeKey !== null,
    staleTime: 30_000,
  });

  return {
    groupsQuery,
    groups,
    visibleGroups,
    activeKey,
    activeGroup,
    transcriptQuery,
    transcript: transcriptQuery.data ?? null,
    groupsQueryKey,
    transcriptQueryKey,
  };
};
