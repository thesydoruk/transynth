export type GlossaryEntry = {
  id: number;
  term: string;
  translation: string | null;
  src_lang: string;
  tgt_lang: string;
  source: string;
  created_at: string;
};

/** Result of a batch glossary enforcement run. */
export type GlossaryEnforceResult = { checked: number; violations: number };

/** A configurable QA validation rule (forbidden characters or max length per GRUP/field). */
export type QARule = {
  id: number;
  game: string;
  rule_type: 'forbidden_chars' | 'max_length';
  signature: string | null;
  path: string | null;
  value: string;
  severity: 'warning' | 'error';
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
