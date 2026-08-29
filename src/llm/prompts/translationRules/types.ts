/** Per-game localization rules injected into translate and verify prompts. */
export type GameRules = {
  en: (targetLang: string) => string[];
  uk: () => string[];
  /** Extra audit bullets for verify prompts (English). */
  verifyEn?: () => string[];
  /** Extra audit bullets for verify prompts (Ukrainian). */
  verifyUk?: () => string[];
};
