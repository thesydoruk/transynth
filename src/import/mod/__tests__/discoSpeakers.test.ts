import { describe, expect, it } from '@jest/globals';
import { buildDiscoSpeakerRowsFromStems } from '../discoSpeakers';

describe('buildDiscoSpeakerRowsFromStems', () => {
  it('groups stems by speaker prefix and counts lines', () => {
    const { speakers, lineCounts } = buildDiscoSpeakerRowsFromStems([
      'Kim Kitsuragi-YARD-1',
      'Kim Kitsuragi-YARD-2',
      'You-HUB-1',
      'Volition-THOUGHT-1',
    ]);

    expect(lineCounts.get('Kim Kitsuragi')).toBe(2);
    expect(lineCounts.get('You')).toBe(1);
    expect(lineCounts.get('Volition')).toBe(1);
    expect(speakers.find((s) => s.speakerKey === 'You')?.isPlayer).toBe(true);
    expect(speakers.find((s) => s.speakerKey === 'Kim Kitsuragi')?.displayName).toBe(
      'Kim Kitsuragi',
    );
  });
});
