import type { Tx } from '../../db';
import type { TranslationStatus } from './statusMachine';

export type TranslationRevisionInput = {
  stringId: number;
  translationId: number | null;
  targetLang: string;
  text: string | null;
  status: TranslationStatus;
  provenance?: string | null;
  model?: string | null;
  note?: string | null;
};

/** Persist one translation revision row. */
export const recordTranslationRevision = async (
  db: Tx,
  input: TranslationRevisionInput,
): Promise<void> => {
  await bulkRecordTranslationRevisions(db, [input]);
};

/** Persist many translation revision rows in one round-trip. */
export const bulkRecordTranslationRevisions = async (
  db: Tx,
  rows: TranslationRevisionInput[],
): Promise<void> => {
  if (rows.length === 0) return;

  await db.query(
    `INSERT INTO translation_revisions(
       src_string_id, translation_id, target_lang, text, status, provenance, model, note
     )
     SELECT s, tid, tl, tx, st, p, m, n
     FROM UNNEST(
       $1::int[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]
     ) AS u(s, tid, tl, tx, st, p, m, n)`,
    [
      rows.map((r) => r.stringId),
      rows.map((r) => r.translationId),
      rows.map((r) => r.targetLang),
      rows.map((r) => r.text),
      rows.map((r) => r.status),
      rows.map((r) => r.provenance ?? null),
      rows.map((r) => r.model ?? null),
      rows.map((r) => r.note ?? null),
    ],
  );
};

/** History note for TM bulk writes (auto-apply vs propagation). */
export const tmRevisionNoteForProvenance = (provenance: string): string =>
  provenance === 'propagation' ? 'tm_propagation' : 'tm';
