import type { DialogScope } from './scope';

/** Kind of a node in the quest-oriented dialog navigator. */
export type DialogTreeKind = 'quest' | 'scene' | 'branch' | 'topic' | 'group';

/**
 * One node of the dialog tree returned to the editor.
 *
 * Quests own scenes, branches, and any leftover topics. Branches own their
 * topics. A synthetic `group` wraps records that have no quest so they stay
 * out of the alphabetical quest list.
 */
export type DialogTreeNode = {
  kind: DialogTreeKind;
  /** Transcript API scope; unused when the node is not selectable. */
  scope: DialogScope;
  key: string;
  label: string;
  sublabel: string | null;
  node_count: number;
  line_count: number;
  translated_count: number;
  qa_count: number;
  timing_sensitive: boolean;
  children: DialogTreeNode[];
};

export type TreeTopicRow = {
  key: string;
  label: string;
  formid_hex: string;
  quest_formid_hex: string | null;
  branch_formid_hex: string | null;
  node_count: number;
  line_count: number;
  translated_count: number;
  qa_count: number;
};

export type TreeBranchRow = {
  key: string;
  label: string;
  formid_hex: string;
  quest_formid_hex: string | null;
  start_topic_formid_hex: string | null;
  node_count: number;
  line_count: number;
  translated_count: number;
  qa_count: number;
};

export type TreeSceneRow = {
  key: string;
  label: string;
  formid_hex: string;
  quest_formid_hex: string | null;
  node_count: number;
  line_count: number;
  translated_count: number;
  qa_count: number;
  timing_sensitive: boolean;
};

export type TreeQuestRow = {
  formid_hex: string;
  edid: string | null;
  name: string | null;
};

/** Stable key of the bucket that holds records with no quest. */
export const ORPHAN_GROUP_KEY = '__orphans__';

const byLabel = (a: DialogTreeNode, b: DialogTreeNode): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

const sum = (nodes: DialogTreeNode[], field: keyof DialogTreeNode): number =>
  nodes.reduce((total, node) => total + (node[field] as number), 0);

const topicNode = (topic: TreeTopicRow): DialogTreeNode => ({
  kind: 'topic',
  scope: 'topics',
  key: topic.key,
  label: topic.label,
  sublabel: topic.formid_hex === topic.label ? null : topic.formid_hex,
  node_count: topic.node_count,
  line_count: topic.line_count,
  translated_count: topic.translated_count,
  qa_count: topic.qa_count,
  timing_sensitive: false,
  children: [],
});

const sceneNode = (scene: TreeSceneRow): DialogTreeNode => ({
  kind: 'scene',
  scope: 'scenes',
  key: scene.key,
  label: scene.label,
  sublabel: scene.formid_hex === scene.label ? null : scene.formid_hex,
  node_count: scene.node_count,
  line_count: scene.line_count,
  translated_count: scene.translated_count,
  qa_count: scene.qa_count,
  timing_sensitive: scene.timing_sensitive,
  children: [],
});

const branchNode = (branch: TreeBranchRow, topics: DialogTreeNode[]): DialogTreeNode => ({
  kind: 'branch',
  scope: 'branches',
  key: branch.key,
  label: branch.label,
  sublabel: branch.formid_hex === branch.label ? null : branch.formid_hex,
  node_count: branch.node_count,
  line_count: branch.line_count,
  translated_count: branch.translated_count,
  qa_count: branch.qa_count,
  timing_sensitive: false,
  children: topics.sort(byLabel),
});

const questLabel = (quest: TreeQuestRow): string =>
  quest.edid?.trim() || quest.name?.trim() || quest.formid_hex;

const rollupQuest = (label: string, key: string, children: DialogTreeNode[]): DialogTreeNode => {
  const sorted = [...children].sort((a, b) => {
    const rank = { scene: 0, branch: 1, topic: 2, quest: 3, group: 4 };
    return rank[a.kind] - rank[b.kind] || byLabel(a, b);
  });
  return {
    kind: 'quest',
    scope: 'conversations',
    key,
    label,
    sublabel: key === label ? null : key,
    node_count: sum(sorted, 'node_count'),
    line_count: sum(sorted, 'line_count'),
    translated_count: sum(sorted, 'translated_count'),
    qa_count: sum(sorted, 'qa_count'),
    timing_sensitive: sorted.some((child) => child.timing_sensitive),
    children: sorted,
  };
};

/**
 * Build the navigator forest from the four dialog tables.
 *
 * Topics are claimed by a branch first (BNAM or the branch start topic), then
 * by their quest, then fall into the orphan group. Empty quest stubs with no
 * children are dropped.
 */
export const assembleDialogTree = (
  quests: TreeQuestRow[],
  scenes: TreeSceneRow[],
  branches: TreeBranchRow[],
  topics: TreeTopicRow[],
): DialogTreeNode[] => {
  const questByFormId = new Map(quests.map((quest) => [quest.formid_hex, quest]));
  const placedTopics = new Set<string>();

  const topicsForBranch = new Map<string, DialogTreeNode[]>();
  for (const branch of branches) topicsForBranch.set(branch.formid_hex, []);

  const claimTopic = (topic: TreeTopicRow, branchFormId: string | null): boolean => {
    if (!branchFormId || placedTopics.has(topic.key)) return false;
    const bucket = topicsForBranch.get(branchFormId);
    if (!bucket) return false;
    placedTopics.add(topic.key);
    bucket.push(topicNode(topic));
    return true;
  };

  for (const topic of topics) {
    claimTopic(topic, topic.branch_formid_hex);
  }
  for (const topic of topics) {
    if (placedTopics.has(topic.key)) continue;
    for (const branch of branches) {
      if (branch.start_topic_formid_hex === topic.formid_hex && claimTopic(topic, branch.formid_hex)) {
        break;
      }
    }
  }

  const childrenByQuest = new Map<string, DialogTreeNode[]>();
  const ensureQuest = (formid: string | null): DialogTreeNode[] | null => {
    if (!formid) return null;
    let kids = childrenByQuest.get(formid);
    if (!kids) {
      kids = [];
      childrenByQuest.set(formid, kids);
    }
    return kids;
  };

  const orphanScenes: DialogTreeNode[] = [];
  const orphanBranches: DialogTreeNode[] = [];
  const orphanTopics: DialogTreeNode[] = [];

  for (const scene of scenes) {
    const kids = ensureQuest(scene.quest_formid_hex);
    if (kids) kids.push(sceneNode(scene));
    else orphanScenes.push(sceneNode(scene));
  }

  for (const branch of branches) {
    const node = branchNode(branch, topicsForBranch.get(branch.formid_hex) ?? []);
    const kids = ensureQuest(branch.quest_formid_hex);
    if (kids) kids.push(node);
    else orphanBranches.push(node);
  }

  for (const topic of topics) {
    if (placedTopics.has(topic.key)) continue;
    const kids = ensureQuest(topic.quest_formid_hex);
    if (kids) kids.push(topicNode(topic));
    else orphanTopics.push(topicNode(topic));
  }

  const questNodes: DialogTreeNode[] = [];
  for (const [formid, children] of childrenByQuest) {
    if (children.length === 0) continue;
    const quest = questByFormId.get(formid);
    const label = quest ? questLabel(quest) : formid;
    questNodes.push(rollupQuest(label, formid, children));
  }
  questNodes.sort(byLabel);

  const orphans = [
    ...orphanScenes.sort(byLabel),
    ...orphanBranches.sort(byLabel),
    ...orphanTopics.sort(byLabel),
  ];
  if (orphans.length === 0) return questNodes;

  questNodes.push({
    kind: 'group',
    scope: 'conversations',
    key: ORPHAN_GROUP_KEY,
    label: ORPHAN_GROUP_KEY,
    sublabel: null,
    node_count: sum(orphans, 'node_count'),
    line_count: sum(orphans, 'line_count'),
    translated_count: sum(orphans, 'translated_count'),
    qa_count: sum(orphans, 'qa_count'),
    timing_sensitive: orphans.some((child) => child.timing_sensitive),
    children: orphans,
  });
  return questNodes;
};
