import { ageDistance } from './ageBand';
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
    const src = (a.source === 'opentts' ? 0 : 1) - (b.source === 'opentts' ? 0 : 1);
    if (src !== 0) return src;
    const qa = a.qualityScore ?? -1;
    const qb = b.qualityScore ?? -1;
    if (qb !== qa) return qb - qa;
    const g = genderRank(a.gender) - genderRank(b.gender);
    if (g !== 0) return g;
    return a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id);
  });

/** Prefer gender match, then closer age band, then higher quality. */
const takeMatchingVoice = (
  pool: UkVoiceLibraryRow[],
  character: UkVoiceCharacter,
): UkVoiceLibraryRow | undefined => {
  if (pool.length === 0) return undefined;
  let bestIdx = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pool.length; i += 1) {
    const voice = pool[i]!;
    const genderPenalty =
      character.gender === 'male' || character.gender === 'female'
        ? voice.gender === character.gender
          ? 0
          : voice.gender === 'unknown'
            ? 8
            : 20
        : voice.gender === 'unknown'
          ? 1
          : 0;
    const agePenalty = ageDistance(character.age, voice.age);
    const qualityBonus = (voice.qualityScore ?? 0) / 100;
    const score = genderPenalty * 100 + agePenalty * 10 - qualityBonus;
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return pool.splice(bestIdx, 1)[0];
};

const reasonFor = (
  character: UkVoiceCharacter,
  voice: UkVoiceLibraryRow,
  genderMatched: boolean,
  ageMatched: boolean,
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
  if (ageMatched) {
    parts.push(`age match (${character.age})`);
  } else {
    parts.push(`age ${character.age} → voice ${voice.age}`);
  }
  if (voice.qualityScore != null) parts.push(`Q=${Math.round(voice.qualityScore)}`);
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
    const voice = takeMatchingVoice(pool, character);
    if (!voice) {
      throw new Error(`Voice pool exhausted while assigning "${character.characterKey}"`);
    }
    const genderMatched =
      (character.gender === 'male' || character.gender === 'female') &&
      voice.gender === character.gender;
    const ageMatched = ageDistance(character.age, voice.age) === 0;

    proposals.push({
      characterKey: character.characterKey,
      characterGender: character.gender,
      characterAge: character.age,
      displayName: character.displayName,
      modCount: character.modCount,
      voiceId: voice.id,
      voiceName: voice.displayName,
      voiceGender: voice.gender,
      voiceAge: voice.age,
      voiceSource: voice.source,
      reason: reasonFor(character, voice, genderMatched, ageMatched),
    });
  }

  return proposals.sort((a, b) => a.characterKey.localeCompare(b.characterKey));
};
