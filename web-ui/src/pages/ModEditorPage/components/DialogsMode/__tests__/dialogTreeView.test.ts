import { describe, expect, it } from 'vitest';
import type { DialogTreeNode } from '../../../../../api';
import {
  ancestorIdsOf,
  bumpDialogTreeProgress,
  filterDialogTree,
  flattenDialogTreeRows,
  treeNodeId,
} from '../dialogTreeView';

const node = (
  partial: Partial<DialogTreeNode> & Pick<DialogTreeNode, 'kind' | 'key' | 'label'>,
): DialogTreeNode => ({
  scope:
    partial.kind === 'quest'
      ? 'conversations'
      : partial.kind === 'scene'
        ? 'scenes'
        : partial.kind === 'branch'
          ? 'branches'
          : 'topics',
  sublabel: null,
  node_count: 1,
  line_count: 2,
  translated_count: 0,
  qa_count: 0,
  timing_sensitive: false,
  children: [],
  ...partial,
});

describe('filterDialogTree', () => {
  const forest = [
    node({
      kind: 'quest',
      key: 'Q1',
      label: 'MQ102',
      children: [
        node({ kind: 'scene', key: '10', label: 'IntroScene' }),
        node({
          kind: 'branch',
          key: '20',
          label: 'HelloBranch',
          children: [node({ kind: 'topic', key: '30', label: 'Greeting' })],
        }),
      ],
    }),
  ];

  it('keeps ancestors of a matching leaf', () => {
    const filtered = filterDialogTree(forest, 'greet', false, 'label');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].children).toHaveLength(1);
    expect(filtered[0].children[0].label).toBe('HelloBranch');
    expect(filtered[0].children[0].children[0].label).toBe('Greeting');
  });

  it('hides a finished leaf when hideDone is on', () => {
    const done = [
      node({
        kind: 'quest',
        key: 'Q1',
        label: 'Q',
        line_count: 4,
        translated_count: 2,
        children: [
          node({ kind: 'topic', key: '1', label: 'Done', line_count: 2, translated_count: 2 }),
          node({ kind: 'topic', key: '2', label: 'Todo', line_count: 2, translated_count: 0 }),
        ],
      }),
    ];
    const filtered = filterDialogTree(done, '', true, 'label');
    expect(filtered[0].children.map((child) => child.label)).toEqual(['Todo']);
  });
});

describe('flattenDialogTreeRows', () => {
  it('emits only expanded children', () => {
    const forest = [
      node({
        kind: 'quest',
        key: 'Q1',
        label: 'Q',
        children: [node({ kind: 'topic', key: '1', label: 'T' })],
      }),
    ];
    const collapsed = flattenDialogTreeRows(forest, new Set());
    expect(collapsed.map((row) => row.node.kind)).toEqual(['quest']);
    const expanded = flattenDialogTreeRows(forest, new Set([treeNodeId(forest[0])]));
    expect(expanded.map((row) => row.node.kind)).toEqual(['quest', 'topic']);
    expect(expanded[1].depth).toBe(1);
  });
});

describe('ancestorIdsOf', () => {
  it('returns the path to a nested topic', () => {
    const quest = node({
      kind: 'quest',
      key: 'Q1',
      label: 'Q',
      children: [
        node({
          kind: 'branch',
          key: '20',
          label: 'B',
          children: [node({ kind: 'topic', key: '30', label: 'T' })],
        }),
      ],
    });
    expect(ancestorIdsOf([quest], 'topics', '30')).toEqual(['quest:Q1', 'branch:20']);
  });
});

describe('bumpDialogTreeProgress', () => {
  it('bumps the leaf and every ancestor', () => {
    const forest = [
      node({
        kind: 'quest',
        key: 'Q1',
        label: 'Q',
        line_count: 4,
        translated_count: 1,
        children: [
          node({
            kind: 'branch',
            key: '20',
            label: 'B',
            line_count: 2,
            translated_count: 0,
            children: [
              node({ kind: 'topic', key: '30', label: 'T', line_count: 2, translated_count: 0 }),
            ],
          }),
        ],
      }),
    ];
    const next = bumpDialogTreeProgress(forest, 'topics', '30', 1);
    expect(next[0].translated_count).toBe(2);
    expect(next[0].children[0].translated_count).toBe(1);
    expect(next[0].children[0].children[0].translated_count).toBe(1);
  });
});
