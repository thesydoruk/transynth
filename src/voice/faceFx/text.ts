/** Cyrillic + Ukrainian ґ. FaceFXWrapper 0.51+ respells when Lang is Ukrainian. */
const CYRILLIC_RE = /[\u0400-\u04FF]/;

export type FaceFxDialogueLanguage = 'Ukrainian' | 'USEnglish';

export const faceFxDialogueLanguage = (text: string): FaceFxDialogueLanguage =>
  CYRILLIC_RE.test(text) ? 'Ukrainian' : 'USEnglish';
