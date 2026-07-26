import { maskPlaceholders } from '../../../utils/placeholders';
import { splitLongSourceText } from '../splitLongText';

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
});
