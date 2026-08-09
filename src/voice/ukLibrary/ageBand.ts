/** Common Voice / character age buckets used for library rows and mapping. */
export type UkVoiceAge =
  | 'teens'
  | 'twenties'
  | 'thirties'
  | 'fourties'
  | 'fifties'
  | 'sixties'
  | 'seventies'
  | 'eighties'
  | 'nineties'
  | 'unknown';

const AGE_ORDER: UkVoiceAge[] = [
  'teens',
  'twenties',
  'thirties',
  'fourties',
  'fifties',
  'sixties',
  'seventies',
  'eighties',
  'nineties',
];

const AGE_RANK = new Map(AGE_ORDER.map((age, index) => [age, index]));

/** Normalize CV `age` column (and typos) to a stable bucket. */
export const parseCvAge = (raw: string | null | undefined): UkVoiceAge => {
  if (!raw) return 'unknown';
  const lower = raw.trim().toLowerCase();
  if (!lower) return 'unknown';
  if (lower === 'forties') return 'fourties';
  if (AGE_RANK.has(lower as UkVoiceAge)) return lower as UkVoiceAge;
  return 'unknown';
};

const ageRank = (age: UkVoiceAge): number | null => {
  if (age === 'unknown') return null;
  return AGE_RANK.get(age) ?? null;
};

/** Distance between age buckets (0 = same). Unknown → large soft penalty. */
export const ageDistance = (a: UkVoiceAge, b: UkVoiceAge): number => {
  const ra = ageRank(a);
  const rb = ageRank(b);
  if (ra == null && rb == null) return 2;
  if (ra == null || rb == null) return 3;
  return Math.abs(ra - rb);
};

/**
 * Infer a FO4 voice-folder age band from the character key / display name.
 * Most adult NPCs default to thirties (prime adult CV band).
 */
export const inferCharacterAge = (
  characterKey: string,
  displayName: string | null = null,
): UkVoiceAge => {
  const text = `${characterKey} ${displayName ?? ''}`.toLowerCase();
  if (
    /child|kiddo|\bkid\b|boy(?![a-z])|girl(?![a-z])|toddler|infant|baby/.test(text) ||
    /child/.test(characterKey.toLowerCase())
  ) {
    return 'teens';
  }
  if (/teen/.test(text)) return 'teens';
  if (
    /elder|elderly|oldman|oldwoman|senior|grandfather|grandmother|\bgrandpa\b|\bgrandma\b/.test(
      text,
    )
  ) {
    return 'sixties';
  }
  if (/young|youth/.test(text)) return 'twenties';
  // Generic adult FO4 voices → prefer thirties as the densest CV adult band.
  return 'thirties';
};

/** Majority age label from a list (ignores unknown/empty). */
export const modeAge = (ages: UkVoiceAge[]): UkVoiceAge => {
  const counts = new Map<UkVoiceAge, number>();
  for (const age of ages) {
    if (age === 'unknown') continue;
    counts.set(age, (counts.get(age) ?? 0) + 1);
  }
  let best: UkVoiceAge = 'unknown';
  let bestCount = 0;
  for (const [age, count] of counts) {
    if (count > bestCount) {
      best = age;
      bestCount = count;
    }
  }
  return best;
};
