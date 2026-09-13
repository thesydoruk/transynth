import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type DialogScope } from '../../../../../api';
import {
  ancestorIdsOf,
  filterDialogTree,
  findTreeNode,
  flattenDialogTreeRows,
  treeNodeId,
} from '../dialogTreeView';
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

const collectExpandableIds = (nodes: Parameters<typeof flattenDialogTreeRows>[0]): string[] => {
  const ids: string[] = [];
  const walk = (list: typeof nodes) => {
    for (const node of list) {
      if (node.children.length > 0) ids.push(treeNodeId(node));
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
};

/**
 * Quest tree and transcript of the dialogs editor.
 *
 * The tree arrives complete, so search, sort, expand, and the "hide finished"
 * toggle run in memory. The transcript of the selected node is fetched
 * separately and is the only request that repeats while the user works.
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
  const treeQueryKey = ['dialog-tree', modId, srcLang, targetLang] as const;

  const treeQuery = useQuery({
    queryKey: treeQueryKey,
    queryFn: () => api.dialogs.tree(modId, srcLang, targetLang),
    staleTime: 60_000,
  });

  const tree = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);

  const visibleTree = useMemo(
    () => filterDialogTree(tree, search, hideDone, sort),
    [tree, search, sort, hideDone],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!groupKey) return;
    const ancestors = ancestorIdsOf(tree, scope, groupKey);
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tree, scope, groupKey]);

  useEffect(() => {
    if (!search.trim()) return;
    const ids = collectExpandableIds(visibleTree);
    if (ids.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [search, visibleTree]);

  const rows = useMemo(() => flattenDialogTreeRows(visibleTree, expanded), [visibleTree, expanded]);

  const activeKey = groupKey && findTreeNode(tree, scope, groupKey) ? groupKey : null;
  const activeNode = activeKey ? findTreeNode(tree, scope, activeKey) : null;

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

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(collectExpandableIds(visibleTree)));
  const collapseAll = () => setExpanded(new Set());

  const setNodeExpanded = (id: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return {
    treeQuery,
    tree,
    visibleTree,
    rows,
    activeKey,
    activeNode,
    activeScope: scope,
    transcriptQuery,
    transcript: transcriptQuery.data ?? null,
    treeQueryKey,
    /** @deprecated alias kept so save/fill hooks keep a stable name. */
    groupsQueryKey: treeQueryKey,
    transcriptQueryKey,
    toggleExpanded,
    expandAll,
    collapseAll,
    setNodeExpanded,
    groupsQuery: treeQuery,
    totalQuestCount: tree.filter((node) => node.kind === 'quest').length,
  };
};
