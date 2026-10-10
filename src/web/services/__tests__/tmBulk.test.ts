import {
  exactTmVoiceSourceModIds,
  tmConfidenceForMethod,
  tmProvenanceForMethod,
  tmStatusForMatch,
  type TmBulkMatch,
} from '../tmBulk';

describe('tmProvenanceForMethod', () => {
  it('maps match methods to tm_auto_* provenance', () => {
    expect(tmProvenanceForMethod('anchor')).toBe('tm_auto_anchor');
    expect(tmProvenanceForMethod('edid')).toBe('tm_auto_edid');
    expect(tmProvenanceForMethod('text_norm')).toBe('tm_auto_text_norm');
    expect(tmProvenanceForMethod('numeric')).toBe('tm_auto_numeric');
  });
});

describe('exactTmVoiceSourceModIds', () => {
  const match = (overrides: Partial<TmBulkMatch> = {}): TmBulkMatch => ({
    stringId: 1,
    text: 'Привіт.',
    method: 'anchor',
    confidence: 0.95,
    sourceModId: 10,
    exactSourceText: true,
    fromReference: false,
    ...overrides,
  });

  it('keeps donor mods from exact non-numeric TM hits', () => {
    expect(
      exactTmVoiceSourceModIds(
        [
          match(),
          match({ stringId: 2, method: 'text_norm', sourceModId: 11, confidence: 0.75 }),
          match({ stringId: 3, method: 'numeric', sourceModId: 12, exactSourceText: false }),
          match({ stringId: 4, sourceModId: 5, exactSourceText: false }),
          match({ stringId: 5, sourceModId: 5 }),
        ],
        5,
      ),
    ).toEqual([10, 11]);
  });
});

describe('tmStatusForMatch', () => {
  const base: TmBulkMatch = {
    stringId: 1,
    text: 'Привіт.',
    method: 'anchor',
    confidence: 0.95,
    sourceModId: null,
    exactSourceText: true,
    fromReference: true,
  };

  it('approves an exact hit from the reference base at once', () => {
    expect(tmStatusForMatch(base)).toBe('reviewed');
    expect(tmProvenanceForMethod('anchor', true)).toBe('tm_reference_anchor');
  });

  it('keeps a number transplant and any live-mod hit as tm', () => {
    expect(tmStatusForMatch({ ...base, method: 'numeric', exactSourceText: false })).toBe('tm');
    expect(tmStatusForMatch({ ...base, fromReference: false, sourceModId: 4 })).toBe('tm');
  });
});

describe('tmConfidenceForMethod', () => {
  it('assigns descending confidence by method priority', () => {
    expect(tmConfidenceForMethod('anchor')).toBe(0.95);
    expect(tmConfidenceForMethod('edid')).toBe(0.85);
    expect(tmConfidenceForMethod('text_norm')).toBe(0.75);
    expect(tmConfidenceForMethod('numeric')).toBe(0.72);
  });
});
