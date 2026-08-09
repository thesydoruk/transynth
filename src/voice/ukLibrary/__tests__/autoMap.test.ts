import { buildUkVoiceAutoMap } from '../autoMap';
import type { UkVoiceCharacter, UkVoiceLibraryRow } from '../types';

const voice = (
  id: string,
  gender: UkVoiceLibraryRow['gender'],
  source: UkVoiceLibraryRow['source'] = 'common_voice',
): UkVoiceLibraryRow => ({
  id,
  source,
  displayName: id,
  description: null,
  gender,
  audioRelPath: `${source}/${id}.wav`,
  transcript: 'тест',
  license: source === 'opentts' ? 'Apache-2.0' : 'CC0',
  durationSec: 5,
  meta: {},
});

const character = (
  key: string,
  gender: UkVoiceCharacter['gender'],
  lineCount = 1,
): UkVoiceCharacter => ({
  characterKey: key,
  displayName: key,
  gender,
  modCount: 1,
  lineCount,
  linkedVoiceId: null,
});

describe('buildUkVoiceAutoMap', () => {
  it('assigns unique voices with gender preference and opentts priority', () => {
    const proposals = buildUkVoiceAutoMap(
      [character('FemaleBoston', 'female', 20), character('MaleEvenToned', 'male', 10)],
      [
        voice('cv-m1', 'male'),
        voice('cv-f1', 'female'),
        voice('lada', 'female', 'opentts'),
        voice('mykyta', 'male', 'opentts'),
      ],
    );

    expect(proposals).toHaveLength(2);
    const byKey = Object.fromEntries(proposals.map((row) => [row.characterKey, row]));
    expect(byKey.FemaleBoston.voiceId).toBe('lada');
    expect(byKey.MaleEvenToned.voiceId).toBe('mykyta');
    expect(byKey.FemaleBoston.reason).toContain('gender match');
    expect(new Set(proposals.map((row) => row.voiceId)).size).toBe(2);
  });

  it('throws when library is smaller than character set', () => {
    expect(() =>
      buildUkVoiceAutoMap(
        [character('A', 'male'), character('B', 'female')],
        [voice('only', 'male')],
      ),
    ).toThrow(/Not enough library voices/);
  });
});
