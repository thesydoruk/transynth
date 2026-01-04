import { describe, it, expect } from 'vitest';
import { maskPlaceholders, applyGlossaryMask, unmask } from './placeholders.js';

describe('maskPlaceholders', () => {
  it('masks printf-style placeholders', () => {
    const { masked, mapping } = maskPlaceholders('Hello %s, you have %d items');
    expect(masked).toBe('Hello ¤PH0¤, you have ¤PH1¤ items');
    expect(mapping['¤PH0¤']).toBe('%s');
    expect(mapping['¤PH1¤']).toBe('%d');
  });

  it('masks curly-brace placeholders', () => {
    const { masked, mapping } = maskPlaceholders('{0} gave {item} to {1}');
    expect(masked).toBe('¤PH0¤ gave ¤PH1¤ to ¤PH2¤');
    expect(mapping['¤PH0¤']).toBe('{0}');
    expect(mapping['¤PH1¤']).toBe('{item}');
    expect(mapping['¤PH2¤']).toBe('{1}');
  });

  it('masks HTML-like tags', () => {
    const { masked } = maskPlaceholders('<b>Bold</b> text');
    expect(masked).toBe('¤PH0¤Bold¤PH1¤ text');
  });

  it('masks $ variables', () => {
    const { masked, mapping } = maskPlaceholders('$PlayerName entered');
    expect(masked).toBe('¤PH0¤ entered');
    expect(mapping['¤PH0¤']).toBe('$PlayerName');
  });

  it('returns empty mapping for plain text', () => {
    const { masked, mapping } = maskPlaceholders('Just a sentence.');
    expect(masked).toBe('Just a sentence.');
    expect(Object.keys(mapping)).toHaveLength(0);
  });
});

describe('unmask', () => {
  it('round-trips: mask → unmask restores original', () => {
    const original = 'Hello %s, you have %d items in {location}';
    const { masked, mapping } = maskPlaceholders(original);
    expect(unmask(masked, mapping)).toBe(original);
  });

  it('handles overlapping-length keys correctly (longest first)', () => {
    const mapping = { '¤PH0¤': 'short', '¤PH10¤': 'longer' };
    const text = 'A ¤PH10¤ and ¤PH0¤';
    expect(unmask(text, mapping)).toBe('A longer and short');
  });
});

describe('applyGlossaryMask', () => {
  it('masks glossary terms', () => {
    const { masked, mapping } = applyGlossaryMask(
      'The Brotherhood of Steel attacked',
      ['Brotherhood of Steel'],
    );
    expect(masked).toBe('The ¤GL0¤ attacked');
    expect(mapping['¤GL0¤']).toBe('Brotherhood of Steel');
  });

  it('round-trips: glossary mask → unmask', () => {
    const original = 'Visit the Brotherhood of Steel at the Institute';
    const { masked, mapping } = applyGlossaryMask(original, ['Brotherhood of Steel', 'Institute']);
    expect(unmask(masked, mapping)).toBe(original);
  });
});
