import type pg from 'pg';
import { withTransaction } from '../../../db';
import { normalizeAutoTranslationQuotes } from '../../../utils/textNorm';
import { getAllProjectSettings } from '../../services/projectSettings';
import type { TranslationStatus } from '../statusMachine';
import { bulkRecordTranslationRevisions } from '../translationRevisions';
import { refreshQAIssuesBatch } from './qaIssues';
import { promoteTranslationsToReference } from './referenceTranslations';

/**
 * One reviewed edit of a source string's translation: the text the reviewer
 * read (`old`, empty when there was none) and the text to store (`new`).
 */
export type TranslationFix = { id: number; old: string; new: string; note?: string };

export type ApplyFixesOptions = {
  targetLang: string;
  status: Extract<TranslationStatus, 'draft' | 'reviewed' | 'human'>;
  provenance: string;
  model?: string | null;
  dryRun?: boolean;
};

export type ApplyFixesResult = {
  /** Source string ids written (in a dry run: the ones that would be). */
  applied: number[];
  unchanged: number[];
  /** The stored text is no longer `old`: the line changed after it was read. */
  stale: { id: number; current: string | null }[];
  rejected: { id: number; why: string }[];
};

type Pending = { fix: TranslationFix; text: string; translationId: number | null };

const QA_CHUNK = 2_000;

const dedupe = (fixes: TranslationFix[], result: ApplyFixesResult): TranslationFix[] => {
  const seen = new Set<number>();
  return fixes.filter((fix) => {
    if (!seen.has(fix.id)) return seen.add(fix.id);
    result.rejected.push({ id: fix.id, why: 'duplicate id in input' });
    return false;
  });
};

const classify = async (
  client: pg.PoolClient,
  fixes: TranslationFix[],
  targetLang: string,
  result: ApplyFixesResult,
): Promise<Pending[]> => {
  const ids = fixes.map((f) => f.id);
  const { rows: strings } = await client.query<{ id: number; is_ignored: boolean }>(
    `SELECT id, is_ignored FROM strings WHERE id = ANY($1::int[])`,
    [ids],
  );
  const { rows: current } = await client.query<{ id: number; src_string_id: number; text: string }>(
    `SELECT id, src_string_id, text FROM translations
      WHERE src_string_id = ANY($1::int[]) AND target_lang = $2
      FOR UPDATE`,
    [ids, targetLang],
  );
  const ignored = new Map(strings.map((s) => [s.id, s.is_ignored]));
  const byString = new Map(current.map((t) => [t.src_string_id, t]));

  const pending: Pending[] = [];
  for (const fix of fixes) {
    const row = byString.get(fix.id);
    const text = normalizeAutoTranslationQuotes(fix.new);
    if (!ignored.has(fix.id)) result.rejected.push({ id: fix.id, why: 'no such string' });
    else if (ignored.get(fix.id)) result.rejected.push({ id: fix.id, why: 'string is marked skip' });
    else if ((row?.text ?? '') !== fix.old) result.stale.push({ id: fix.id, current: row?.text ?? null });
    else if (!text.trim()) result.rejected.push({ id: fix.id, why: 'empty translation' });
    else if (text === row?.text) result.unchanged.push(fix.id);
    else pending.push({ fix, text, translationId: row?.id ?? null });
  }
  return pending;
};

const write = async (
  client: pg.PoolClient,
  pending: Pending[],
  opts: ApplyFixesOptions,
): Promise<{ id: number; src_string_id: number; text: string }[]> => {
  const existing = pending.filter((p) => p.translationId !== null);
  const fresh = pending.filter((p) => p.translationId === null);
  const model = opts.model ?? null;

  const { rows: updated } = await client.query<{ id: number; src_string_id: number; text: string }>(
    `UPDATE translations t
        SET text = u.text, status = $3, provenance = $4, model = $5,
            confidence = 1.0, user_id = NULL, updated_at = NOW()
       FROM UNNEST($1::int[], $2::text[]) AS u(id, text)
      WHERE t.id = u.id
      RETURNING t.id, t.src_string_id, t.text`,
    [existing.map((p) => p.translationId), existing.map((p) => p.text), opts.status, opts.provenance, model],
  );
  const { rows: inserted } = await client.query<{ id: number; src_string_id: number; text: string }>(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, model, updated_at)
     SELECT u.sid, $3, u.text, $4, 1.0, $5, $6, NOW()
       FROM UNNEST($1::int[], $2::text[]) AS u(sid, text)
     RETURNING id, src_string_id, text`,
    [fresh.map((p) => p.fix.id), fresh.map((p) => p.text), opts.targetLang, opts.status, opts.provenance, model],
  );
  const written = [...updated, ...inserted];

  const notes = new Map(pending.map((p) => [p.fix.id, p.fix.note]));
  await bulkRecordTranslationRevisions(
    client,
    written.map((w) => ({
      stringId: w.src_string_id,
      translationId: w.id,
      targetLang: opts.targetLang,
      text: w.text,
      status: opts.status,
      provenance: opts.provenance,
      model,
      note: notes.get(w.src_string_id) || 'apply',
    })),
  );
  // The RAG example holds the old text; `npm run rag:index-missing` embeds the new one.
  await client.query(`DELETE FROM translation_examples WHERE translation_id = ANY($1::int[])`, [
    written.map((w) => w.id),
  ]);
  return written;
};

/**
 * Write reviewed edits the way an editor save does — revision, QA refresh,
 * reference promotion — but in bulk and guarded: a line is written only if
 * its stored text is still exactly `old`, so an edit made after the review
 * read the line is never overwritten. Voice needs nothing here: a take whose
 * text changed is no longer current and the next `missing` voice job redoes it.
 */
export const applyTranslationFixes = async (
  db: pg.Pool,
  fixes: TranslationFix[],
  opts: ApplyFixesOptions,
): Promise<ApplyFixesResult> => {
  const result: ApplyFixesResult = { applied: [], unchanged: [], stale: [], rejected: [] };
  const unique = dedupe(fixes, result);
  if (unique.length === 0) return result;

  const written = await withTransaction(db, async (client) => {
    const pending = await classify(client, unique, opts.targetLang, result);
    if (opts.dryRun) result.applied = pending.map((p) => p.fix.id);
    return opts.dryRun || pending.length === 0 ? [] : write(client, pending, opts);
  });
  if (opts.dryRun) return result;

  result.applied = written.map((w) => w.src_string_id);
  for (let i = 0; i < result.applied.length; i += QA_CHUNK) {
    await refreshQAIssuesBatch(db, result.applied.slice(i, i + QA_CHUNK), opts.targetLang);
  }
  const settings = await getAllProjectSettings(db);
  if (settings['workflow.promote_reference_on_approve'] && result.applied.length > 0) {
    await promoteTranslationsToReference(db, {
      stringIds: result.applied,
      targetLang: opts.targetLang,
      origin: 'auto_approve',
    });
  }
  return result;
};
