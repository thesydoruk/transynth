import { describe, expect, it } from '@jest/globals';
import { buildDiscoSpeakerRowsFromStems } from '../import/speakers';

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

  it('does not split hyphenated actor names at the first dash', () => {
    const { speakers, lineCounts } = buildDiscoSpeakerRowsFromStems([
      'Mega Rich Light-Bending Guy-CONTAINERYARD  LIGHT BENDING GUY-287',
      'alternative-0-Horse-Faced Woman-WHIRLING F1  MAN WITH SUNGLASSES-118-0',
      'Door, Room -3-WHIRLING F2  KLAASJE DOOR-10',
    ]);

    expect(lineCounts.get('Mega Rich Light-Bending Guy')).toBe(1);
    expect(lineCounts.get('Horse-Faced Woman')).toBe(1);
    expect(lineCounts.get('Door, Room -3')).toBe(1);
    expect(speakers.map((s) => s.speakerKey)).toEqual([
      'Door, Room -3',
      'Horse-Faced Woman',
      'Mega Rich Light-Bending Guy',
    ]);
    expect(lineCounts.has('Mega Rich Light')).toBe(false);
    expect(lineCounts.has('Horse')).toBe(false);
  });
});
