import { assembleDialogTree, ORPHAN_GROUP_KEY } from '../assembleDialogTree';
import type { TreeBranchRow, TreeQuestRow, TreeSceneRow, TreeTopicRow } from '../assembleDialogTree';

const topic = (partial: Partial<TreeTopicRow> & Pick<TreeTopicRow, 'key' | 'label'>): TreeTopicRow => ({
  formid_hex: `t${partial.key}`,
  quest_formid_hex: null,
  branch_formid_hex: null,
  node_count: 1,
  line_count: 2,
  translated_count: 1,
  qa_count: 0,
  ...partial,
});

const branch = (
  partial: Partial<TreeBranchRow> & Pick<TreeBranchRow, 'key' | 'label'>,
): TreeBranchRow => ({
  formid_hex: `b${partial.key}`,
  quest_formid_hex: null,
  start_topic_formid_hex: null,
  node_count: 2,
  line_count: 4,
  translated_count: 2,
  qa_count: 0,
  ...partial,
});

const scene = (partial: Partial<TreeSceneRow> & Pick<TreeSceneRow, 'key' | 'label'>): TreeSceneRow => ({
  formid_hex: `s${partial.key}`,
  quest_formid_hex: null,
  node_count: 3,
  line_count: 6,
  translated_count: 3,
  qa_count: 1,
  timing_sensitive: false,
  ...partial,
});

const quest = (partial: Partial<TreeQuestRow> & Pick<TreeQuestRow, 'formid_hex'>): TreeQuestRow => ({
  edid: null,
  name: null,
  ...partial,
});

describe('assembleDialogTree', () => {
  it('nests scenes, branches, and leftover topics under their quest', () => {
    const tree = assembleDialogTree(
      [quest({ formid_hex: 'Q1', edid: 'MQ102', name: 'Sanctuary' })],
      [scene({ key: '10', label: 'IntroScene', quest_formid_hex: 'Q1' })],
      [branch({ key: '20', label: 'HelloBranch', formid_hex: 'BR1', quest_formid_hex: 'Q1' })],
      [
        topic({
          key: '30',
          label: 'Greeting',
          formid_hex: 'T1',
          quest_formid_hex: 'Q1',
          branch_formid_hex: 'BR1',
        }),
        topic({ key: '31', label: 'LooseTopic', formid_hex: 'T2', quest_formid_hex: 'Q1' }),
      ],
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe('quest');
    expect(tree[0].label).toBe('MQ102');
    expect(tree[0].scope).toBe('conversations');
    expect(tree[0].key).toBe('Q1');
    expect(tree[0].children.map((child) => child.kind)).toEqual(['scene', 'branch', 'topic']);
    expect(tree[0].children[1].children.map((child) => child.label)).toEqual(['Greeting']);
    expect(tree[0].children[2].label).toBe('LooseTopic');
    expect(tree[0].line_count).toBe(6 + 4 + 2);
    expect(tree[0].timing_sensitive).toBe(false);
  });

  it('claims a start topic even when BNAM is missing', () => {
    const tree = assembleDialogTree(
      [quest({ formid_hex: 'Q1', edid: 'Q' })],
      [],
      [
        branch({
          key: '20',
          label: 'StartOnly',
          formid_hex: 'BR1',
          quest_formid_hex: 'Q1',
          start_topic_formid_hex: 'T1',
        }),
      ],
      [topic({ key: '30', label: 'Start', formid_hex: 'T1', quest_formid_hex: 'Q1' })],
    );

    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].kind).toBe('branch');
    expect(tree[0].children[0].children.map((child) => child.label)).toEqual(['Start']);
  });

  it('does not place a topic under both its branch and the quest', () => {
    const tree = assembleDialogTree(
      [quest({ formid_hex: 'Q1', edid: 'Q' })],
      [],
      [branch({ key: '20', label: 'B', formid_hex: 'BR1', quest_formid_hex: 'Q1' })],
      [
        topic({
          key: '30',
          label: 'Once',
          formid_hex: 'T1',
          quest_formid_hex: 'Q1',
          branch_formid_hex: 'BR1',
        }),
      ],
    );

    const labels: string[] = [];
    const walk = (nodes: typeof tree) => {
      for (const node of nodes) {
        if (node.kind === 'topic') labels.push(node.label);
        walk(node.children);
      }
    };
    walk(tree);
    expect(labels).toEqual(['Once']);
  });

  it('keeps records without a quest in the orphan group', () => {
    const tree = assembleDialogTree(
      [],
      [scene({ key: '10', label: 'OrphanScene' })],
      [branch({ key: '20', label: 'OrphanBranch' })],
      [topic({ key: '30', label: 'OrphanTopic' })],
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe('group');
    expect(tree[0].key).toBe(ORPHAN_GROUP_KEY);
    expect(tree[0].children.map((child) => child.kind)).toEqual(['scene', 'branch', 'topic']);
  });

  it('drops empty quest stubs', () => {
    const tree = assembleDialogTree([quest({ formid_hex: 'EMPTY', edid: 'Unused' })], [], [], []);
    expect(tree).toEqual([]);
  });

  it('still groups children when the quest row is only a stub formid', () => {
    const tree = assembleDialogTree(
      [],
      [scene({ key: '10', label: 'S', quest_formid_hex: 'DEADBEEF' })],
      [],
      [],
    );
    expect(tree[0].key).toBe('DEADBEEF');
    expect(tree[0].label).toBe('DEADBEEF');
    expect(tree[0].children[0].label).toBe('S');
  });
});
