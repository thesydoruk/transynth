/**
 * Pairing of strings between two versions of one mod.
 *
 * A record path keeps only the subrecord signature, so a record that repeats
 * one signature (INFO with several NAM1 responses, TERM ITXT items, QUST stage
 * logs, RACE TTGP/FMRN, BPTD BPTN, GMST/MESG) yields several strings sharing
 * `(formid_hex, path)`. Keying the versions by that pair alone kept one sibling
 * per record and gave its translation to every other sibling of the new
 * version (14,485 wrong rows on the 2026-11-07 Fallout4 re-import).
 *
 * Siblings are therefore paired inside their record: by identical normalised
 * source first, and a changed source is only assumed when exactly one string
 * on each side is left — never guessed between several.
 */

export type VersionString = { formid_hex: string; path: string; text_norm: string };

export type VersionPair<N, O> = {
  next: N;
  old: O;
  /** True when the pair was made by elimination and the source text differs. */
  sourceChanged: boolean;
};

export type VersionPairing<N, O> = {
  pairs: VersionPair<N, O>[];
  /** New strings with no counterpart: added, or ambiguous among changed siblings. */
  unmatchedNew: N[];
  /** Old strings with no counterpart: removed, or ambiguous among changed siblings. */
  unmatchedOld: O[];
};

const anchorKey = (s: VersionString): string => `${s.formid_hex}|${s.path}`;

const groupByAnchor = <T extends VersionString>(items: T[]): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = anchorKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
};

/**
 * Pair the strings of a new mod version with those of an old one. Input order
 * is kept, so passing rows ordered by string id pairs equal texts in record
 * order when a record repeats one text.
 */
export const pairVersionStrings = <N extends VersionString, O extends VersionString>(
  newStrings: N[],
  oldStrings: O[],
): VersionPairing<N, O> => {
  const pairs: VersionPair<N, O>[] = [];
  const unmatchedNew: N[] = [];
  const unmatchedOld: O[] = [];

  const oldGroups = groupByAnchor(oldStrings);
  for (const [key, group] of groupByAnchor(newStrings)) {
    const olds = oldGroups.get(key) ?? [];
    oldGroups.delete(key);
    const used = new Set<number>();
    const leftover: N[] = [];

    for (const next of group) {
      const index = olds.findIndex((old, i) => !used.has(i) && old.text_norm === next.text_norm);
      if (index === -1) {
        leftover.push(next);
        continue;
      }
      used.add(index);
      pairs.push({ next, old: olds[index]!, sourceChanged: false });
    }

    const remainingOld = olds.filter((_, i) => !used.has(i));
    if (leftover.length === 1 && remainingOld.length === 1) {
      pairs.push({ next: leftover[0]!, old: remainingOld[0]!, sourceChanged: true });
    } else {
      unmatchedNew.push(...leftover);
      unmatchedOld.push(...remainingOld);
    }
  }
  for (const group of oldGroups.values()) unmatchedOld.push(...group);

  return { pairs, unmatchedNew, unmatchedOld };
};
