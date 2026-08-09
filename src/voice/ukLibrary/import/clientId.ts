import crypto from 'node:crypto';

/** Stable library id for a Common Voice speaker (`cv:` + 16 hex chars). */
export const cvSpeakerVoiceId = (clientId: string): string =>
  `cv:${crypto.createHash('sha256').update(clientId).digest('hex').slice(0, 16)}`;

/** Normalize CV demographic gender labels to male/female/unknown. */
export const parseCvGender = (raw: string | null | undefined): 'male' | 'female' | 'unknown' => {
  if (!raw) return 'unknown';
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith('male') || lower === 'm') return 'male';
  if (lower.startsWith('female') || lower === 'f') return 'female';
  return 'unknown';
};
