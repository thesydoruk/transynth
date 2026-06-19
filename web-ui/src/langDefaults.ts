/**
 * Centralised default-language helpers for the frontend.
 *
 * All pages and the API client should read the user-chosen source / target
 * language through these helpers rather than hard-coding 'en' / 'uk'.
 *
 * The values are persisted in `localStorage` via the Settings page.
 * If the user has not configured anything yet the compile-time fallbacks
 * (`DEFAULT_SRC_LANG` / `DEFAULT_TGT_LANG`) are used instead.
 */

/* ── localStorage keys (must match SettingsPage) ─────────────────────────── */

/** localStorage key for the default source language. */
export const LS_SRC_LANG = 'fo4-src-lang';

/** localStorage key for the default target language. */
export const LS_TGT_LANG = 'fo4-tgt-lang';

/** localStorage key for the last game context seen in a game-scoped route. */
export const LS_CURRENT_GAME = 'fo4-current-game';

/* ── Compile-time fallbacks ──────────────────────────────────────────────── */

/** Fallback source language when nothing is stored. */
export const DEFAULT_SRC_LANG = 'en';

/** Fallback target language when nothing is stored. */
export const DEFAULT_TGT_LANG = 'uk';

/* ── Supported content languages ─────────────────────────────────────────── */

/**
 * Full list of content locales supported by the translation workflow.
 *
 * Keep this list as the single source of truth for source/target selectors
 * across pages that work with mod/EET/CSV content.
 */
export const SUPPORTED_CONTENT_LANGUAGES = [
  'en',
  'uk',
  'ru',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'pl',
  'cs',
  'ja',
  'zh',
  'ko',
] as const;

/** Strongly typed content language code. */
export type SupportedContentLanguage = (typeof SUPPORTED_CONTENT_LANGUAGES)[number];

/** Human-friendly labels for content language selectors. */
export const CONTENT_LANGUAGE_LABELS: Record<SupportedContentLanguage, string> = {
  en: 'English',
  uk: 'Ukrainian',
  ru: 'Russian',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  cs: 'Czech',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
};

export type ContentLanguageOption = {
  code: SupportedContentLanguage;
  label: string;
};

/** Build language options from the single supported-language source of truth. */
export const getContentLanguageOptions = (): ContentLanguageOption[] =>
  SUPPORTED_CONTENT_LANGUAGES.map((code) => ({
    code,
    label: `${CONTENT_LANGUAGE_LABELS[code]} (${code})`,
  }));

/* ── Runtime accessors ───────────────────────────────────────────────────── */

/**
 * Return the user-preferred source language (or the compile-time default).
 *
 * Reads from `localStorage` on every call so it always reflects the latest
 * value even if the user changes it in the Settings page without a reload.
 */
export const getSrcLang = (): string => localStorage.getItem(LS_SRC_LANG) ?? DEFAULT_SRC_LANG;

/**
 * Return the user-preferred target language (or the compile-time default).
 */
export const getTgtLang = (): string => localStorage.getItem(LS_TGT_LANG) ?? DEFAULT_TGT_LANG;

/** Return the last persisted game context from the shell, if any. */
export const getCurrentGame = (): string | null => localStorage.getItem(LS_CURRENT_GAME);

/** Persist the current shell game context for cross-page navigation continuity. */
export const setCurrentGame = (gameId: string): void => {
  localStorage.setItem(LS_CURRENT_GAME, gameId);
};

/** React Query key for mod-list fetches scoped by game and content-language pair. */
export const modListQueryKey = (game?: string, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
  ['mods', game ?? null, srcLang, targetLang] as const;
