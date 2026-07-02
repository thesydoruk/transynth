/**
 * Translation status definitions and validation.
 *
 * Status lifecycle (automated pipeline → manual edit):
 *
 *   (new string) → tm / fuzzy / auto / human (system)
 *               → draft (manual save in editor)
 *               → reviewed (auto-approve on save, or legacy data)
 *               → skip (marked as non-translatable; excluded from translation pipelines)
 *
 * `rejected` and `deleted` remain valid stored values for existing data.
 */

/** All possible statuses a translation record can hold. */
export type TranslationStatus =
  | 'draft'
  | 'tm'
  | 'fuzzy'
  | 'auto'
  | 'human'
  | 'reviewed'
  | 'rejected'
  | 'skip'
  | 'deleted';

/** Set of all valid `TranslationStatus` string literals. */
export const VALID_TRANSLATION_STATUSES = new Set<TranslationStatus>([
  'draft',
  'tm',
  'fuzzy',
  'auto',
  'human',
  'reviewed',
  'rejected',
  'skip',
  'deleted',
]);

/** Type guard: returns true if `s` is a valid `TranslationStatus`. */
export const isValidTranslationStatus = (s: string): s is TranslationStatus =>
  VALID_TRANSLATION_STATUSES.has(s as TranslationStatus);
