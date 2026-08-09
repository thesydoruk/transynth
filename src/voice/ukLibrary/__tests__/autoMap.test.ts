import { buildUkVoiceAutoMap } from '../autoMap';
import type { UkVoiceCharacter, UkVoiceLibraryRow } from '../types';

const voice = (
  id: string,
  gender: UkVoiceLibraryRow['gender'],
  age: UkVoiceLibraryRow['age'] = 'thirties',
  source: UkVoiceLibraryRow['source'] = 'common_voice',
  qualityScore: number | null = 70,
): UkVoiceLibraryRow => ({
  id,
  source,
  displayName: id,
  description: null,
  gender,
  age,
  audioRelPath: `${source}/${id}.wav`,
  transcript: 'тест',
  license: source === 'opentts' ? 'Apache-2.0' : 'CC0',
  durationSec: 5,
  qualityScore,
  genderSource: null,
  meanF0Hz: null,
  analyzedAt: null,
  speakerKey: id,
  meta: {},
});

const character = (
  key: string,
  gender: UkVoiceCharacter['gender'],
  age: UkVoiceCharacter['age'] = 'thirties',
  lineCount = 1,
): UkVoiceCharacter => ({
  characterKey: key,
  displayName: key,
  gender,
  age,
  modCount: 1,
  lineCount,
  linkedVoiceId: null,
});

describe('buildUkVoiceAutoMap', () => {
  it('assigns unique voices with gender and age preference', () => {
    const proposals = buildUkVoiceAutoMap(
      [
        character('FemaleBoston', 'female', 'thirties', 20),
        character('MaleChild', 'male', 'teens', 10),
      ],
      [
        voice('cv-m-adult', 'male', 'thirties'),
        voice('cv-m-teen', 'male', 'teens', 'common_voice', 60),
        voice('cv-f1', 'female', 'thirties'),
        voice('lada', 'female', 'thirties', 'opentts', 90),
      ],
    );
    const byKey = Object.fromEntries(proposals.map((row) => [row.characterKey, row]));
    expect(byKey.FemaleBoston.voiceId).toBe('lada');
    expect(byKey.FemaleBoston.reason).toContain('gender match');
    expect(byKey.MaleChild.voiceId).toBe('cv-m-teen');
    expect(byKey.MaleChild.reason).toContain('age match');
  });
});
