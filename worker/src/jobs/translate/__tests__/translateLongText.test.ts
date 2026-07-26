import { maskPlaceholders } from '../../../../../src/utils/placeholders';
import { splitLongSourceText, splitLongSourceForTranslate } from '../../shared/splitLongText';

describe('long-text chunk remasking', () => {
  it('gives each split part its own PH0 mask keys', () => {
    const source = `${'Line one.\r\n'.repeat(40)}${'Line two.\r\n'.repeat(40)}`;
    const parts = splitLongSourceText(source, 200);
    expect(parts.length).toBeGreaterThan(1);

    for (const part of parts) {
      const { masked, mapping } = maskPlaceholders(part);
      expect(Object.keys(mapping)).toContain('¤PH0¤');
      expect(masked).not.toMatch(/¤PH10\d+¤/);
    }
  });

  it('limits line breaks per translate chunk', () => {
    const source = 'Paragraph.\r\n'.repeat(50);
    const parts = splitLongSourceForTranslate(source, 2000, 8);
    expect(parts.length).toBeGreaterThan(3);
    for (const part of parts) {
      expect((part.match(/\r\n|\r|\n/g) ?? []).length).toBeLessThanOrEqual(8);
    }
    expect(parts.join('')).toBe(source);
  });
});
