/**
 * A single string entry within a coherence group — one source string whose
 * current translation differs from at least one other string in the same group.
 */
export type CoherenceEntry = {
  string_id: number;
  source_text: string;
  text_norm: string;
  edid: string | null;
  signature: string;
  path_simplified: string;
  mod_id: number;
  mod_name: string;
  /** Game identifier for the mod — used for editor deep-links. */
  mod_game: string;
  translation_id: number | null;
  /** The current best translation for this string. */
  translation: string;
  status: string;
};

/**
 * A coherence group — all source strings sharing the same normalised text
 * that are currently translated inconsistently.
 */
export type CoherenceGroup = {
  text_norm: string;
  /** Representative raw source text for display. */
  source_text: string;
  /** Number of distinct translation variants in this group. */
  variant_count: number;
  entries: CoherenceEntry[];
};

/** Paginated coherence report returned by GET /api/coherence. */
export type CoherenceResult = {
  groups: CoherenceGroup[];
  /** Total number of inconsistency groups (before pagination). */
  total: number;
};
