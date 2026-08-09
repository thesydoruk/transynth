import crypto from 'node:crypto';

/** Stable library id for a Common Voice speaker (`cv:` + 16 hex chars). */
export const cvSpeakerVoiceId = (clientId: string): string =>
  `cv:${crypto.createHash('sha256').update(clientId).digest('hex').slice(0, 16)}`;

export type CvGender = 'male' | 'female' | 'unknown';

/** Normalize CV demographic gender labels to male/female/unknown. */
export const parseCvGender = (raw: string | null | undefined): CvGender => {
  if (!raw) return 'unknown';
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith('male') || lower === 'm') return 'male';
  if (lower.startsWith('female') || lower === 'f') return 'female';
  return 'unknown';
};

/** Majority gender from CV metadata (ignores unknown). */
export const modeCvGender = (genders: CvGender[]): CvGender => {
  let male = 0;
  let female = 0;
  for (const gender of genders) {
    if (gender === 'male') male += 1;
    else if (gender === 'female') female += 1;
  }
  if (male === 0 && female === 0) return 'unknown';
  if (male === female) return 'unknown';
  return male > female ? 'male' : 'female';
};
