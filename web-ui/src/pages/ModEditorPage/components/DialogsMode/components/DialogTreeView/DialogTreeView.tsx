import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type DialogTreeNode, type DialogTreeEdge } from '../../../../../../api';
import { DialogNodeCard } from '../DialogNodeCard';
import styles from './DialogTreeView.module.scss';

/** Props for the dialog tree visualization. */
export interface DialogTreeViewProps {
  /** All INFO nodes belonging to the selected DIAL topic. */
  nodes: DialogTreeNode[];
  /** All directed edges between INFO nodes (previous → current). */
  edges: DialogTreeEdge[];
  /** Target language code passed down to {@link DialogNodeCard}. */
  targetLang: string;
  /** React Query key array invalidated after inline saves. */
  queryKey: unknown[];
  /** Whether tree data is still loading. */
  isLoading: boolean;
}

/**
 * Renders the dialog tree for a single DIAL topic as a vertically nested
 * list of {@link DialogNodeCard} cards.
 *
 * Tree structure is derived from the `edges` array where every edge has
 * `edge_kind = 'previous'`.  An edge `from → to` means the "from" node
 * precedes the "to" node in the dialog chain.  Root nodes are those that
 * do not appear as the `to` side of any edge (i.e. they have no parent).
 *
 * Bethesda dialog is mostly linear, so the tree is usually a simple chain.
 * Branches are rendered by indenting child cards beneath their parent.
 * Cycles are detected via a `visited` set and broken to avoid infinite
 * recursion.
 */
export const DialogTreeView = ({ nodes, edges, targetLang, queryKey, isLoading }: DialogTreeViewProps) => {
  const { t } = useTranslation();

  /**
   * Derived tree data:
   * - `nodeMap`: infoFormId → node
   * - `childrenMap`: infoFormId → [child infoFormId, ...]
   * - `rootIds`: infoFormIds with no incoming edge
   */
  const { nodeMap, childrenMap, rootIds } = useMemo(() => {
    const nodeMap = new Map<string, DialogTreeNode>(
      nodes.map((n) => [n.info_formid_hex, n]),
    );

    // childrenMap: from → [to]  (a "from" node precedes its "to" children)
    const childrenMap = new Map<string, string[]>();
    const hasIncoming = new Set<string>();

    for (const edge of edges) {
      if (edge.edge_kind !== 'previous') continue;
      const children = childrenMap.get(edge.from_info_formid_hex);
      if (children) {
        children.push(edge.to_info_formid_hex);
      } else {
        childrenMap.set(edge.from_info_formid_hex, [edge.to_info_formid_hex]);
      }
      hasIncoming.add(edge.to_info_formid_hex);
    }

    // Root nodes: present in nodeMap but not in hasIncoming
    const rootIds = [...nodeMap.keys()].filter((id) => !hasIncoming.has(id));

    return { nodeMap, childrenMap, rootIds };
  }, [nodes, edges]);

  if (isLoading) {
    return <div className={styles.info}>{t('dialogs.loadingTree')}</div>;
  }

  if (nodes.length === 0) {
    return <div className={styles.info}>{t('dialogs.noNodes')}</div>;
  }

  /**
   * Walks a linear chain of nodes (each with exactly one child) and renders
   * them as a flat sequence of cards.  When a branching point is reached
   * (0 or 2+ children), the chain stops and each branch is rendered
   * recursively inside a `.children` wrapper that adds indentation.
   *
   * `visited` prevents infinite loops when cycles exist in the graph.
   */
  const renderChain = (startId: string, visited: Set<string>): React.ReactNode => {
    const chainNodes: DialogTreeNode[] = [];
    let currentId: string | null = startId;
    const localVisited = new Set(visited);

    // Walk the linear chain
    while (currentId) {
      if (localVisited.has(currentId)) break; // cycle guard
      const node = nodeMap.get(currentId);
      if (!node) break;

      localVisited.add(currentId);
      chainNodes.push(node);

      const childIds: string[] = childrenMap.get(currentId) ?? [];
      if (childIds.length === 1 && !localVisited.has(childIds[0])) {
        currentId = childIds[0]; // linear continuation
      } else {
        currentId = null; // leaf, branch, or cycle — stop
      }
    }

    if (chainNodes.length === 0) return null;

    // Children of the last node determine whether the chain branches
    const lastNode = chainNodes[chainNodes.length - 1];
    const branchChildIds = (childrenMap.get(lastNode.info_formid_hex) ?? [])
      .filter((cid) => !localVisited.has(cid));

    return (
      <div key={startId} className={styles.branch}>
        {chainNodes.map((node) => (
          <DialogNodeCard
            key={node.info_formid_hex}
            node={node}
            targetLang={targetLang}
            queryKey={queryKey}
          />
        ))}
        {branchChildIds.length > 0 && (
          <div className={styles.children}>
            {branchChildIds.map((cid) => renderChain(cid, localVisited))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.tree}>
      {rootIds.map((id) => renderChain(id, new Set()))}
    </div>
  );
};
