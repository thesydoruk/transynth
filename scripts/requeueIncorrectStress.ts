#!/usr/bin/env tsx
/**
 * Clear LLM stress marks that disagree with the ua-word-stress reference trie,
 * then optionally enqueue stress-place (scope: missing) per affected mod.
 *
 * Usage:
 *   npm run stress:requeue-incorrect -- [--dry-run] [--enqueue] [--mod-id N] [--target-lang uk]
 *
 * Requires: npm install ua-word-stress (one-off on prod: npm install ua-word-stress --no-save)
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, validateConfig } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { allocateJobId, closeJobsQueue, enqueueJob } from '../worker/src/core/queue';
import { writeJobSnapshot } from '../worker/src/core/snapshots';
import { STRESS_COMBINING_ACUTE, stripStressMarks } from '../src/voice/stressedTranslation';

type StressedRow = {
  id: number;
  text: string;
  text_stressed: string;
  mod_id: number;
};

const stripStress = stripStressMarks;

const extractWords = (text: string): string[] => {
  const out: string[] = [];
  const re = /([\p{L}\p{M}]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1].normalize('NFC'));
  }
  return out;
};

const isLetterWord = (word: string): boolean => /^\p{L}+$/u.test(stripStress(word));

const markWord = (trie: { mark: (w: string) => string | null }, plain: string): string | null => {
  const direct = trie.mark(plain);
  if (direct) return direct;
  const lower = plain.toLocaleLowerCase('uk-UA');
  const lowerMark = trie.mark(lower);
  if (!lowerMark) return null;
  if (plain === lower) return lowerMark;
  if (plain[0] === plain[0].toLocaleUpperCase('uk-UA')) {
    return plain[0] + lowerMark.slice(1);
  }
  return lowerMark;
};

const rowHasWrongStress = (
  trie: {
    mark: (w: string) => string | null;
    lookupFull: (w: string) => { uncertain?: boolean; type?: string } | null;
  },
  row: StressedRow,
): boolean => {
  const baseWords = extractWords(row.text);
  const stressedWords = extractWords(row.text_stressed);
  if (stripStress(row.text_stressed) !== row.text) return true;
  if (baseWords.length !== stressedWords.length) return true;

  for (let i = 0; i < baseWords.length; i++) {
    const plain = stripStress(stressedWords[i]);
    const got = stressedWords[i];
    if (!isLetterWord(plain) || !got.includes(STRESS_COMBINING_ACUTE)) continue;
    const full = trie.lookupFull(plain) ?? trie.lookupFull(plain.toLocaleLowerCase('uk-UA'));
    if (!full) continue;
    if (full.uncertain && full.type === 'heteronym') continue;
    const expected = markWord(trie, plain);
    if (!expected) continue;
    if (got.normalize('NFC') !== expected.normalize('NFC')) return true;
  }
  return false;
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('stress:requeue-incorrect')
  .option('target-lang', { type: 'string', default: CONFIG.defaultTgtLang })
  .option('mod-id', { type: 'number', describe: 'Limit to one mod' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('enqueue', {
    type: 'boolean',
    default: false,
    describe: 'Start stress-place (missing) per mod',
  })
  .help()
  .parse();

validateConfig();
const db = openDb();

const loadTrie = async () => {
  try {
    const mod = await import('ua-word-stress');
    const triePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../node_modules/ua-word-stress/data/ua_stress.ctrie.gz',
    );
    return mod.UaStressTrie.fromFile(triePath);
  } catch {
    throw new Error('ua-word-stress is not installed. Run: npm install ua-word-stress --no-save');
  }
};

const enqueueStressPlace = async (modId: number, targetLang: string): Promise<number> => {
  const jobId = await allocateJobId();
  await writeJobSnapshot({
    jobId,
    kind: 'stress-place',
    modId,
    status: 'running',
    done: 0,
    total: 0,
    error: null,
    data: { jobId, modId, placedCount: 0 },
  });
  await enqueueJob(
    {
      kind: 'stress-place',
      modId,
      params: {
        srcLang: CONFIG.defaultSrcLang,
        targetLang,
        scope: 'missing',
      },
    },
    jobId,
  );
  return jobId;
};

const run = async (): Promise<void> => {
  const targetLang = String(argv['target-lang']).trim().toLowerCase();
  const modId = argv['mod-id'] as number | undefined;
  const trie = await loadTrie();

  const { rows } = await db.query<StressedRow>(
    `SELECT t.id, t.text, t.text_stressed, r.mod_id
       FROM translations t
       JOIN strings s ON s.id = t.src_string_id
       JOIN records r ON r.id = s.record_id
      WHERE t.target_lang = $1
        AND t.text_stressed IS NOT NULL
        AND btrim(t.text_stressed) <> ''
        AND t.stress_src_text = t.text
        AND ($2::int IS NULL OR r.mod_id = $2)
      ORDER BY r.mod_id, t.id`,
    [targetLang, modId ?? null],
  );

  const wrongIds: number[] = [];
  const modCounts = new Map<number, number>();
  for (const row of rows) {
    if (!rowHasWrongStress(trie, row)) continue;
    wrongIds.push(row.id);
    modCounts.set(row.mod_id, (modCounts.get(row.mod_id) ?? 0) + 1);
  }

  log.info(
    `Checked ${rows.length} stressed row(s); ${wrongIds.length} incorrect (${modCounts.size} mod(s))`,
  );
  for (const [id, count] of [...modCounts.entries()].sort((a, b) => b[1] - a[1])) {
    log.info(`  mod_id=${id} — ${count} row(s) to requeue`);
  }

  if (wrongIds.length === 0 || argv['dry-run']) return;

  const chunk = 500;
  for (let i = 0; i < wrongIds.length; i += chunk) {
    const slice = wrongIds.slice(i, i + chunk);
    await db.query(
      `UPDATE translations
          SET text_stressed = NULL,
              stress_src_text = NULL,
              stress_source = NULL,
              updated_at = NOW()
        WHERE id = ANY($1::int[])`,
      [slice],
    );
  }
  log.info(`Cleared stress marks on ${wrongIds.length} translation(s)`);

  if (!argv.enqueue) return;

  for (const affectedModId of modCounts.keys()) {
    const jobId = await enqueueStressPlace(affectedModId, targetLang);
    log.info(`Enqueued stress-place job #${jobId} for mod_id=${affectedModId} (scope=missing)`);
  }
};

try {
  await run();
} finally {
  await closeJobsQueue();
  await closeDb();
}
