/** English → Ukrainian glossary pair used in prompts and DB seeding. */
export interface GlossaryEntry {
  /** English source term (matched on word boundaries, case-insensitive). */
  term: string;
  /** Canonical Ukrainian translation (base form; inflect as grammar requires). */
  translation: string;
}
