import { pairVersionStrings } from '../importDiffMatch';

type S = { id: string; formid_hex: string; path: string; text_norm: string };

const s = (id: string, text_norm: string, formid_hex = '0001A2B3', path = 'INFO\\NAM1'): S => ({
  id,
  formid_hex,
  path,
  text_norm,
});

const pairIds = (pairs: { next: S; old: S; sourceChanged: boolean }[]) =>
  pairs.map((p) => [p.next.id, p.old.id, p.sourceChanged]);

describe('pairVersionStrings', () => {
  it('pairs INFO responses by text when their order changes between versions', () => {
    // Old version: [yes, no]; new version: [no, yes]. Keyed by FormID + path
    // alone, "no" would have carried the last old entry's translation.
    const result = pairVersionStrings(
      [s('n1', 'no, thanks.'), s('n2', 'yes, please.')],
      [s('o1', 'yes, please.'), s('o2', 'no, thanks.')],
    );

    expect(pairIds(result.pairs)).toEqual([
      ['n1', 'o2', false],
      ['n2', 'o1', false],
    ]);
    expect(result.unmatchedNew).toEqual([]);
    expect(result.unmatchedOld).toEqual([]);
  });

  it('treats a lone leftover on each side of a record as a changed source', () => {
    const result = pairVersionStrings(
      [s('n1', 'yes, please.'), s('n2', 'no. go away.')],
      [s('o1', 'yes, please.'), s('o2', 'no, thanks.')],
    );

    expect(pairIds(result.pairs)).toEqual([
      ['n1', 'o1', false],
      ['n2', 'o2', true],
    ]);
  });

  it('never guesses between several changed siblings', () => {
    // Two BPTN names rewritten in one BPTD record: nothing says which is which.
    const result = pairVersionStrings(
      [s('n1', 'torso', '0001', 'BPTD\\BPTN'), s('n2', 'left foot', '0001', 'BPTD\\BPTN')],
      [s('o1', 'body', '0001', 'BPTD\\BPTN'), s('o2', 'l foot', '0001', 'BPTD\\BPTN')],
    );

    expect(result.pairs).toEqual([]);
    expect(result.unmatchedNew.map((x) => x.id)).toEqual(['n1', 'n2']);
    expect(result.unmatchedOld.map((x) => x.id)).toEqual(['o1', 'o2']);
  });

  it('does not hand a surviving sibling to an added one', () => {
    // Old record had one response, the new one has two: only the identical
    // text carries; the new sibling is added, not a changed copy of the old.
    const result = pairVersionStrings(
      [s('n1', 'yes, please.'), s('n2', 'maybe later.')],
      [s('o1', 'yes, please.')],
    );

    expect(pairIds(result.pairs)).toEqual([['n1', 'o1', false]]);
    expect(result.unmatchedNew.map((x) => x.id)).toEqual(['n2']);
  });

  it('pairs repeated identical texts in record order', () => {
    const result = pairVersionStrings(
      [s('n1', 'yes.'), s('n2', 'yes.')],
      [s('o1', 'yes.'), s('o2', 'yes.')],
    );

    expect(pairIds(result.pairs)).toEqual([
      ['n1', 'o1', false],
      ['n2', 'o2', false],
    ]);
  });

  it('keeps records apart and reports removed and added records', () => {
    const result = pairVersionStrings(
      [s('n1', 'sturges', 'A', 'NPC_\\FULL'), s('n2', 'preston', 'C', 'NPC_\\FULL')],
      [s('o1', 'sturges', 'A', 'NPC_\\FULL'), s('o2', 'mama murphy', 'B', 'NPC_\\FULL')],
    );

    expect(pairIds(result.pairs)).toEqual([['n1', 'o1', false]]);
    expect(result.unmatchedNew.map((x) => x.id)).toEqual(['n2']);
    expect(result.unmatchedOld.map((x) => x.id)).toEqual(['o2']);
  });
});
