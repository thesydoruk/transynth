import { describe, it, expect } from '@jest/globals';
import { unmask } from '../../../utils/placeholders';
import { maskDiscoLockitMarkup, maskDiscoLockitMarkupIfDisco } from '../discoMarkupMask';

describe('maskDiscoLockitMarkup', () => {
  it('wraps italics, dashes, quotes, and title singles', () => {
    const { masked, mapping } = maskDiscoLockitMarkup(
      `He says -- "If by 'fun stuff,' you *mean* alcohol."`,
    );
    expect(masked).toBe(
      'He says ¤EM0¤ ¤Q0¤If by ¤TS0¤fun stuff,¤TS0¤ you ¤IT0¤mean¤IT0¤ alcohol.¤Q0¤',
    );
    expect(mapping['¤IT0¤']).toBe('*');
    expect(mapping['¤EM0¤']).toBe('--');
    expect(mapping['¤Q0¤']).toBe('"');
    expect(mapping['¤TS0¤']).toBe("'");
    expect(unmask(masked, mapping)).toBe(`He says -- "If by 'fun stuff,' you *mean* alcohol."`);
  });

  it('lets the model translate words between paired keys', () => {
    const { mapping } = maskDiscoLockitMarkup('You *belong* here -- "now".');
    expect(unmask('Ти ¤IT0¤належиш¤IT0¤ сюди ¤EM0¤ ¤Q0¤зараз¤Q0¤.', mapping)).toBe(
      'Ти *належиш* сюди -- "зараз".',
    );
  });

  it('is a no-op for non-Disco games', () => {
    expect(maskDiscoLockitMarkupIfDisco('You *belong* here', 'fo4')).toEqual({
      masked: 'You *belong* here',
      mapping: {},
    });
  });
});
