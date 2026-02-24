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

/* ── Compile-time fallbacks ──────────────────────────────────────────────── */

/** Fallback source language when nothing is stored. */
export const DEFAULT_SRC_LANG = 'en';

/** Fallback target language when nothing is stored. */
export const DEFAULT_TGT_LANG = 'uk';

/* ── Runtime accessors ───────────────────────────────────────────────────── */

/**
 * Return the user-preferred source language (or the compile-time default).
 *
 * Reads from `localStorage` on every call so it always reflects the latest
 * value even if the user changes it in the Settings page without a reload.
 */
export const getSrcLang = (): string =>
  localStorage.getItem(LS_SRC_LANG) ?? DEFAULT_SRC_LANG;

/**
 * Return the user-preferred target language (or the compile-time default).
 */
export const getTgtLang = (): string =>
  localStorage.getItem(LS_TGT_LANG) ?? DEFAULT_TGT_LANG;
