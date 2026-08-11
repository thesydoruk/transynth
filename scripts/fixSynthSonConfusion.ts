/**
 * Fix Ukrainian translations where Fallout "synth" was mistranslated as "син" (son).
 *
 * Only touches rows whose English source contains synth/synths and does NOT contain
 * son/sons — so legitimate "son" + "synth" lines are left alone.
 *
 *   node --import tsx/esm scripts/fixSynthSonConfusion.ts [--dry-run]
 */
import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { rewriteSonFormsToSynth } from '../src/localization/synthSonConfusion';
import { stressedMatchesSource, stripStressMarks } from '../src/voice/stressedTranslation';

const dryRun = process.argv.includes('--dry-run');

const SYNTH_SRC_RE = /\bsynths?\b/i;
const SON_SRC_RE = /\bsons?\b/i;

/** Same rewrite on stressed text, ignoring combining acute when matching. */
const rewriteStressedSonForms = (stressed: string, plainFixed: string): string | null => {
  const stripped = stripStressMarks(stressed);
  if (stripped === plainFixed) return stressed;
  const rewritten = rewriteSonFormsToSynth(stressed);
  // Stress marks sit after vowels; rewriting син→синт only appends т after н.
  if (!stressedMatchesSource(rewritten, plainFixed)) return null;
  return rewritten;
};

const main = async (): Promise<void> => {
  const db = openDb();
  const { rows } = await db.query<{
    id: number;
    mod_id: number;
    source: string;
    text: string;
    text_stressed: string | null;
  }>(
    `SELECT t.id, r.mod_id, s.text_raw AS source, t.text, t.text_stressed
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id
     JOIN records r ON r.id = s.record_id
     WHERE t.target_lang = 'uk'
       AND s.text_raw ~* '\\msynth'
       AND t.text ~* '(^|[^[:alnum:]])син(а|у|ом|ові|і|и|ів|ам|ами|ах)?([^[:alnum:]]|$)'`,
  );

  let fixed = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!SYNTH_SRC_RE.test(row.source) || SON_SRC_RE.test(row.source)) {
      skipped += 1;
      continue;
    }
    const next = rewriteSonFormsToSynth(row.text);
    if (next === row.text) {
      skipped += 1;
      continue;
    }
    let nextStressed: string | null = row.text_stressed;
    if (row.text_stressed) {
      nextStressed = rewriteStressedSonForms(row.text_stressed, next);
      if (nextStressed == null) {
        // Drop stale stressed text rather than keep wrong letters.
        nextStressed = null;
      }
    }
    console.log(
      JSON.stringify({
        id: row.id,
        mod: row.mod_id,
        before: row.text,
        after: next,
      }),
    );
    if (!dryRun) {
      await db.query(
        `UPDATE translations
            SET text = $2,
                text_stressed = $3,
                stress_src_text = CASE WHEN $3::text IS NULL THEN NULL ELSE $2 END,
                updated_at = NOW()
          WHERE id = $1`,
        [row.id, next, nextStressed],
      );
    }
    fixed += 1;
  }

  log.info(`${dryRun ? '[dry-run] ' : ''}fixed=${fixed} skipped=${skipped} scanned=${rows.length}`);
  await closeDb();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
