import { parseSpeakerGender } from '../../../../dialog';
import { parseAddresseeKind } from './participants';
import type { DialogLine } from './lines';
import type { DialogEntryRow } from './scope';

/** One INFO node of a topic, as read from `dialog_nodes`. */
export type TopicNodeRow = {
  node_id: number;
  info_formid_hex: string;
  speaker_name: string | null;
  speaker_key: string | null;
  speaker_gender: string | null;
  addressee_kind: string | null;
  addressee_name: string | null;
  addressee_gender: string | null;
  lines: DialogLine[];
};

/** One `previous → current` link between two INFO nodes. */
export type TopicEdgeRow = {
  from_info_formid_hex: string;
  to_info_formid_hex: string;
  edge_kind: string;
};

/**
 * Order the INFO nodes of a topic the way the dialog actually plays and assign
 * each one an indentation depth.
 *
 * Bethesda dialog is mostly linear, so depth only grows at a real branch point
 * (a node with more than one continuation). Without that rule a 40-line chain
 * would be indented 40 times and become unreadable.
 *
 * Edges pointing outside the topic (their INFO lives in a master plugin) are
 * ignored — treating them as parents would hide their target from the output.
 * Nodes left unreachable by a cycle are appended as extra entry points so the
 * transcript always contains every node of the topic exactly once.
 *
 * @param nodes - Nodes of the topic, in import order.
 * @param edges - Edges of the topic.
 * @param topicFormId - FormID of the owning topic, copied onto every entry.
 */
export const flattenDialogTree = (
  nodes: TopicNodeRow[],
  edges: TopicEdgeRow[],
  topicFormId: string,
): DialogEntryRow[] => {
  const nodeMap = new Map(nodes.map((node) => [node.info_formid_hex, node]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const edge of edges) {
    if (edge.edge_kind !== 'previous') continue;
    if (!nodeMap.has(edge.from_info_formid_hex) || !nodeMap.has(edge.to_info_formid_hex)) continue;
    const siblings = children.get(edge.from_info_formid_hex);
    if (siblings) {
      if (!siblings.includes(edge.to_info_formid_hex)) siblings.push(edge.to_info_formid_hex);
    } else {
      children.set(edge.from_info_formid_hex, [edge.to_info_formid_hex]);
    }
    hasParent.add(edge.to_info_formid_hex);
  }

  const entries: DialogEntryRow[] = [];
  const visited = new Set<string>();

  const walk = (rootId: string): void => {
    const stack: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
    while (stack.length > 0) {
      const { id, depth } = stack.pop()!;
      if (visited.has(id)) continue;
      const node = nodeMap.get(id);
      if (!node) continue;
      visited.add(id);

      entries.push({
        id: `node-${node.node_id}`,
        depth,
        section: null,
        speaker: node.speaker_name,
        speaker_key: node.speaker_key,
        speaker_gender: parseSpeakerGender(node.speaker_gender),
        addressee_kind: parseAddresseeKind(node.addressee_kind),
        addressee: node.addressee_name,
        addressee_gender: parseSpeakerGender(node.addressee_gender),
        alias_id: null,
        info_formid_hex: node.info_formid_hex,
        topic_formid_hex: topicFormId,
        variant_index: 1,
        variant_count: 1,
        lines: node.lines,
      });

      const next = children.get(id) ?? [];
      const childDepth = next.length > 1 ? depth + 1 : depth;
      for (let i = next.length - 1; i >= 0; i--) stack.push({ id: next[i], depth: childDepth });
    }
  };

  for (const node of nodes) {
    if (!hasParent.has(node.info_formid_hex)) walk(node.info_formid_hex);
  }
  for (const node of nodes) {
    if (!visited.has(node.info_formid_hex)) walk(node.info_formid_hex);
  }

  return entries;
};
