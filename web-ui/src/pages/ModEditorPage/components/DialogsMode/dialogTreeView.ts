import type { DialogScope, DialogTreeNode } from '../../../../api';
import type { GroupSort } from './hooks/useDialogsState';

/** One visible row of the virtualized navigator tree. */
export type DialogTreeRow = {
  node: DialogTreeNode;
  depth: number;
  expanded: boolean;
  /** Unique among the current forest: kind + key. */
  id: string;
};

export const treeNodeId = (node: DialogTreeNode): string => `${node.kind}:${node.key}`;

const percent = (node: DialogTreeNode) =>
  node.line_count === 0 ? 1 : node.translated_count / node.line_count;

const isDone = (node: DialogTreeNode) =>
  node.line_count > 0 && node.translated_count >= node.line_count;

const comparators: Record<GroupSort, (a: DialogTreeNode, b: DialogTreeNode) => number> = {
  label: (a, b) => a.label.localeCompare(b.label),
  progress: (a, b) => percent(a) - percent(b) || a.label.localeCompare(b.label),
  size: (a, b) => b.line_count - a.line_count || a.label.localeCompare(b.label),
};

const KIND_RANK: Record<DialogTreeNode['kind'], number> = {
  scene: 0,
  branch: 1,
  topic: 2,
  quest: 3,
  group: 4,
};

const sortChildren = (nodes: DialogTreeNode[], sort: GroupSort): DialogTreeNode[] =>
  [...nodes].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || comparators[sort](a, b));

const nodeMatches = (node: DialogTreeNode, needle: string): boolean =>
  needle === '' ||
  node.label.toLowerCase().includes(needle) ||
  (node.sublabel?.toLowerCase().includes(needle) ?? false) ||
  node.key.toLowerCase().includes(needle);

/**
 * Keep a node when it matches the search, is unfinished (if asked), or has a
 * visible descendant. Children are sorted the same way at every level.
 */
export const filterDialogTree = (
  nodes: DialogTreeNode[],
  search: string,
  hideDone: boolean,
  sort: GroupSort,
): DialogTreeNode[] => {
  const needle = search.trim().toLowerCase();

  const walk = (list: DialogTreeNode[]): DialogTreeNode[] => {
    const kept: DialogTreeNode[] = [];
    for (const node of sortChildren(list, sort)) {
      const children = walk(node.children);
      const selfMatch = nodeMatches(node, needle);
      const hiddenAsDone = hideDone && isDone(node) && children.length === 0;
      if (hiddenAsDone) continue;
      if (needle && !selfMatch && children.length === 0) continue;
      kept.push({ ...node, children });
    }
    return kept;
  };

  return walk(nodes);
};

/** Walk the forest and collect every ancestor id of the selected node. */
export const ancestorIdsOf = (
  nodes: DialogTreeNode[],
  scope: DialogScope,
  key: string,
): string[] => {
  const path: string[] = [];

  const walk = (list: DialogTreeNode[], trail: string[]): boolean => {
    for (const node of list) {
      const id = treeNodeId(node);
      const next = [...trail, id];
      if (node.kind !== 'group' && node.scope === scope && node.key === key) {
        path.push(...trail);
        return true;
      }
      if (walk(node.children, next)) return true;
    }
    return false;
  };

  walk(nodes, []);
  return path;
};

/** Flatten expanded nodes into virtualizer rows. */
export const flattenDialogTreeRows = (
  nodes: DialogTreeNode[],
  expanded: ReadonlySet<string>,
): DialogTreeRow[] => {
  const rows: DialogTreeRow[] = [];

  const walk = (list: DialogTreeNode[], depth: number) => {
    for (const node of list) {
      const id = treeNodeId(node);
      const canExpand = node.children.length > 0;
      const isExpanded = canExpand && expanded.has(id);
      rows.push({ node, depth, expanded: isExpanded, id });
      if (isExpanded) walk(node.children, depth + 1);
    }
  };

  walk(nodes, 0);
  return rows;
};

const bumpNode = (node: DialogTreeNode, delta: number): DialogTreeNode => ({
  ...node,
  translated_count: Math.min(Math.max(node.translated_count + delta, 0), node.line_count),
});

/**
 * Apply a +1/−1 translation-progress delta to the selected node and every
 * ancestor so the tree bars stay in sync without a refetch.
 */
export const bumpDialogTreeProgress = (
  nodes: DialogTreeNode[],
  scope: DialogScope,
  key: string,
  delta: number,
): DialogTreeNode[] => {
  if (delta === 0) return nodes;

  const walk = (list: DialogTreeNode[]): { next: DialogTreeNode[]; hit: boolean } => {
    let hit = false;
    const next = list.map((node) => {
      if (node.kind !== 'group' && node.scope === scope && node.key === key) {
        hit = true;
        return bumpNode(node, delta);
      }
      const child = walk(node.children);
      if (!child.hit) return node;
      hit = true;
      return bumpNode({ ...node, children: child.next }, delta);
    });
    return { next, hit };
  };

  return walk(nodes).next;
};

export const findTreeNode = (
  nodes: DialogTreeNode[],
  scope: DialogScope,
  key: string,
): DialogTreeNode | null => {
  for (const node of nodes) {
    if (node.kind !== 'group' && node.scope === scope && node.key === key) return node;
    const child = findTreeNode(node.children, scope, key);
    if (child) return child;
  }
  return null;
};
