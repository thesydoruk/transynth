import type { DialogEntry } from '../../../../api';

/** Gutter drawn to the left of one transcript turn. */
export type TranscriptTreeGuide = {
  /** At each indent column, whether a vertical rail continues past this row. */
  rails: boolean[];
  /** Last child at this depth — draws an elbow instead of a tee. */
  isLast: boolean;
};

/**
 * Compute file-tree guides from the depth-annotated transcript.
 *
 * A later sibling at the same depth (before the walk goes shallower) keeps the
 * rail open. Linear chains stay at depth 0 and get no gutter.
 */
export const buildTranscriptGuides = (entries: DialogEntry[]): TranscriptTreeGuide[] =>
  entries.map((entry, index) => {
    let isLast = true;
    for (let look = index + 1; look < entries.length; look++) {
      const next = entries[look];
      if (next.depth < entry.depth) break;
      if (next.depth === entry.depth) {
        isLast = false;
        break;
      }
    }

    const rails: boolean[] = [];
    for (let col = 0; col < entry.depth; col++) {
      let continues = false;
      for (let look = index + 1; look < entries.length; look++) {
        const next = entries[look];
        if (next.depth < col) break;
        if (next.depth === col) {
          continues = true;
          break;
        }
      }
      rails.push(continues);
    }

    return { rails, isLast };
  });

/**
 * Hide descendants of collapsed branch points. A collapsed entry keeps itself
 * and drops every following turn that sits deeper until the walk returns.
 */
export const visibleTranscriptEntries = (
  entries: DialogEntry[],
  collapsed: ReadonlySet<string>,
): DialogEntry[] => {
  const visible: DialogEntry[] = [];
  let skipBelow: number | null = null;

  for (const entry of entries) {
    if (skipBelow !== null) {
      if (entry.depth > skipBelow) continue;
      skipBelow = null;
    }
    visible.push(entry);
    if (collapsed.has(entry.id)) skipBelow = entry.depth;
  }

  return visible;
};

/** True when the next visible turns are indented under this one. */
export const entryHasChildren = (entries: DialogEntry[], index: number): boolean => {
  const next = entries[index + 1];
  return next !== undefined && next.depth > entries[index].depth;
};
