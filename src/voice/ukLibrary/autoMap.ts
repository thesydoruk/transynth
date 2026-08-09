import type {
  UkVoiceAutoMapProposal,
  UkVoiceCharacter,
  UkVoiceGender,
  UkVoiceLibraryRow,
} from './types';

const genderRank = (gender: UkVoiceGender): number => {
  if (gender === 'male' || gender === 'female') return 0;
  return 1;
};

const sortCharacters = (characters: UkVoiceCharacter[]): UkVoiceCharacter[] =>
  [...characters].sort((a, b) => {
    if (b.lineCount !== a.lineCount) return b.lineCount - a.lineCount;
    if (b.modCount !== a.modCount) return b.modCount - a.modCount;
    return a.characterKey.localeCompare(b.characterKey);
  });

const sortVoices = (voices: UkVoiceLibraryRow[]): UkVoiceLibraryRow[] =>
  [...voices].sort((a, b) => {
    // Prefer studio opentts, then higher quality, then definite gender, then name.
    const src = (a.source === 'opentts' ? 0 : 1) - (b.source === 'opentts' ? 0 : 1);
    if (src !== 0) return src;
    const qa = a.qualityScore ?? -1;
    const qb = b.qualityScore ?? -1;
    if (qb !== qa) return qb - qa;
    const g = genderRank(a.gender) - genderRank(b.gender);
    if (g !== 0) return g;
    return a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id);
  });

const takeMatchingVoice = (
  pool: UkVoiceLibraryRow[],
  gender: UkVoiceGender,
): UkVoiceLibraryRow | undefined => {
  if (gender === 'male' || gender === 'female') {
    const exact = pool.findIndex((voice) => voice.gender === gender);
    if (exact >= 0) return pool.splice(exact, 1)[0];
  }
  const unknown = pool.findIndex((voice) => voice.gender === 'unknown');
  if (unknown >= 0) return pool.splice(unknown, 1)[0];
  // Last resort: opposite/any remaining voice so uniqueness is preserved.
  return pool.shift();
};

const reasonFor = (
  character: UkVoiceCharacter,
  voice: UkVoiceLibraryRow,
  genderMatched: boolean,
): string => {
  const parts: string[] = [];
  if (voice.source === 'opentts') {
    parts.push('studio opentts voice (Apache-2.0)');
  } else {
    parts.push('Common Voice UA clip (CC0)');
  }
  if (genderMatched) {
    parts.push(`gender match (${character.gender})`);
  } else if (character.gender === 'unknown') {
    parts.push('character gender unknown — assigned next unused voice');
  } else if (voice.gender === 'unknown') {
    parts.push(`no unused ${character.gender} library voice — used gender-unknown clip`);
  } else {
    parts.push(
      `no unused ${character.gender} library voice — reused opposite-gender pool to keep voices unique`,
    );
  }
  if (character.lineCount > 0) {
    parts.push(
      `priority by ${character.lineCount} dialog lines across ${character.modCount} mod(s)`,
    );
  }
  return parts.join('; ');
};

/**
 * Build a unique character→voice proposal. Each library voice is used at most once.
 * Throws when there are more characters than library voices.
 */
export const buildUkVoiceAutoMap = (
  characters: UkVoiceCharacter[],
  voices: UkVoiceLibraryRow[],
): UkVoiceAutoMapProposal[] => {
  if (characters.length === 0) return [];
  if (voices.length < characters.length) {
    throw new Error(
      `Not enough library voices (${voices.length}) for ${characters.length} characters. ` +
        `Import more Common Voice clips (npm run voice:import-uk-library).`,
    );
  }

  const pool = sortVoices(voices);
  const proposals: UkVoiceAutoMapProposal[] = [];

  for (const character of sortCharacters(characters)) {
    const beforeIds = new Set(pool.map((voice) => voice.id));
    const voice = takeMatchingVoice(pool, character.gender);
    if (!voice) {
      throw new Error(`Voice pool exhausted while assigning "${character.characterKey}"`);
    }
    beforeIds.delete(voice.id);
    const genderMatched =
      (character.gender === 'male' || character.gender === 'female') &&
      voice.gender === character.gender;

    proposals.push({
      characterKey: character.characterKey,
      characterGender: character.gender,
      displayName: character.displayName,
      modCount: character.modCount,
      voiceId: voice.id,
      voiceName: voice.displayName,
      voiceGender: voice.gender,
      voiceSource: voice.source,
      reason: reasonFor(character, voice, genderMatched),
    });
  }

  return proposals.sort((a, b) => a.characterKey.localeCompare(b.characterKey));
};
