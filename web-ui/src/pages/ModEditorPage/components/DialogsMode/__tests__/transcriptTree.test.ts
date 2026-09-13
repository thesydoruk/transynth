import { describe, expect, it } from 'vitest';
import type { DialogEntry } from '../../../../../api';
import {
  buildTranscriptGuides,
  entryHasChildren,
  visibleTranscriptEntries,
} from '../transcriptTree';

const entry = (id: string, depth: number): DialogEntry => ({
  id,
  depth,
  section: null,
  speaker: 'A',
  speaker_key: null,
  speaker_gender: 'male',
  addressee_kind: 'player',
  addressee: null,
  addressee_gender: 'any',
  alias_id: null,
  info_formid_hex: id,
  topic_formid_hex: 'T',
  variant_index: 1,
  variant_count: 1,
  lines: [],
});

describe('buildTranscriptGuides', () => {
  it('marks the last sibling and keeps a rail for an earlier branch', () => {
    const guides = buildTranscriptGuides([entry('a', 0), entry('b', 1), entry('c', 1)]);
    expect(guides[0]).toEqual({ rails: [], isLast: true });
    expect(guides[1]).toEqual({ rails: [false], isLast: false });
    expect(guides[2]).toEqual({ rails: [false], isLast: true });
  });

  it('does not treat a later branch at the same depth as a sibling', () => {
    const guides = buildTranscriptGuides([
      entry('a', 0),
      entry('b', 1),
      entry('c', 0),
      entry('d', 1),
    ]);
    expect(guides[1].isLast).toBe(true);
    expect(guides[3].isLast).toBe(true);
  });
});

describe('visibleTranscriptEntries', () => {
  it('hides deeper turns under a collapsed branch point', () => {
    const entries = [entry('a', 0), entry('b', 1), entry('c', 1), entry('d', 0)];
    expect(visibleTranscriptEntries(entries, new Set(['a'])).map((item) => item.id)).toEqual([
      'a',
      'd',
    ]);
  });
});

describe('entryHasChildren', () => {
  it('is true only when the next turn is deeper', () => {
    const entries = [entry('a', 0), entry('b', 1), entry('c', 1)];
    expect(entryHasChildren(entries, 0)).toBe(true);
    expect(entryHasChildren(entries, 1)).toBe(false);
    expect(entryHasChildren(entries, 2)).toBe(false);
  });
});
