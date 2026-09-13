import {
  alignTextToSlots,
  classifySlotKind,
  formatPartsTemplate,
  hasTranslatableParts,
  joinParts,
  parseLlmParts,
  splitTranslateSource,
  validateTranslatedParts,
} from '../textParts';

describe('splitTranslateSource', () => {
  it('keeps plain text as a single part', () => {
    const split = splitTranslateSource('Are you ready?');
    expect(split.parts).toEqual(['Are you ready?']);
    expect(split.slots).toEqual([]);
  });

  it('turns placeholders into integer slots and hides raw tokens', () => {
    const split = splitTranslateSource('Listen, <Alias=Player>, we need %d caps.');
    expect(split.parts).toEqual(['Listen, ', 0, ', we need ', 1, ' caps.']);
    expect(split.slots.map((slot) => ({ i: slot.i, kind: slot.kind, raw: slot.raw }))).toEqual([
      { i: 0, kind: 'alias', raw: '<Alias=Player>' },
      { i: 1, kind: 'printf', raw: '%d' },
    ]);
    expect(formatPartsTemplate(split.parts)).toBe('Listen, {0}, we need {1} caps.');
    expect(joinParts(['Слухай, ', 0, ', нам треба ', 1, ' кришок.'], split.slots)).toBe(
      'Слухай, <Alias=Player>, нам треба %d кришок.',
    );
  });

  it('reuses the same slot index for Disco paired markup', () => {
    const split = splitTranslateSource('You *belong* here.', 'disco');
    expect(split.parts).toEqual(['You ', 0, 'belong', 0, ' here.']);
    expect(split.slots).toEqual([{ i: 0, raw: '*', kind: 'markup' }]);
    expect(joinParts(split.parts, split.slots)).toBe('You *belong* here.');
  });

  it('classifies line-break runs as break slots', () => {
    const split = splitTranslateSource('Para one\r\n\r\nPara two');
    expect(split.parts).toEqual(['Para one', 0, 'Para two']);
    expect(split.slots[0]?.kind).toBe('break');
    expect(split.slots[0]?.raw).toBe('\r\n\r\n');
  });
});

describe('validateTranslatedParts', () => {
  const split = splitTranslateSource('Hello <Alias=Player>, %d left.');

  it('allows reordering slot ids', () => {
    expect(
      validateTranslatedParts(split.parts, ['Лишилось ', 1, ' у ', 0, '.'], split.slots).ok,
    ).toBe(true);
  });

  it('rejects a dropped or invented slot', () => {
    expect(validateTranslatedParts(split.parts, ['Привіт, ', 0], split.slots).ok).toBe(false);
    expect(
      validateTranslatedParts(split.parts, ['Привіт, ', 0, ' ', 1, ' ', 2], split.slots).ok,
    ).toBe(false);
  });

  it('rejects a leaked raw token inside a string part', () => {
    expect(
      validateTranslatedParts(split.parts, ['Привіт, <Alias=Player>', 0, ' ', 1], split.slots).ok,
    ).toBe(false);
  });
});

describe('parseLlmParts', () => {
  it('accepts compact string|int arrays and {t,i} objects', () => {
    expect(parseLlmParts(['Hi ', 0])).toEqual(['Hi ', 0]);
    expect(parseLlmParts([{ t: 'Hi ' }, { i: 0 }])).toEqual(['Hi ', 0]);
    expect(parseLlmParts([])).toBeNull();
    expect(parseLlmParts([{ x: 1 }])).toBeNull();
  });
});

describe('alignTextToSlots', () => {
  it('maps the same raw token in a translation onto the source index', () => {
    const source = splitTranslateSource('Hello <Alias=Player>');
    const aligned = alignTextToSlots('Привіт, <Alias=Player>', source.slots);
    expect(aligned).toEqual(['Привіт, ', 0]);
  });
});

describe('classifySlotKind / hasTranslatableParts', () => {
  it('labels common token families', () => {
    expect(classifySlotKind('%s')).toBe('printf');
    expect(classifySlotKind('{0}')).toBe('var');
    expect(classifySlotKind('[Mod]')).toBe('tag');
    expect(classifySlotKind('*', '¤IT0¤')).toBe('markup');
  });

  it('treats slot-only rows as non-translatable', () => {
    expect(hasTranslatableParts([0, 1])).toBe(false);
    expect(hasTranslatableParts([' ', 0])).toBe(false);
    expect(hasTranslatableParts(['Hi', 0])).toBe(true);
  });
});
