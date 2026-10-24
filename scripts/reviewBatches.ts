#!/usr/bin/env tsx
/**
 * Cut mods into review batches for a whole-corpus review.
 *
 * Dialogue comes out as whole conversations (quest scenes in phase order, then
 * branches and topic trees, with speaker, addressee and gender on every line);
 * other text by family — prose, quest, item, face — grouped by record or item
 * series. Each batch lists the canonical names it mentions and the QA hints its
 * lines carry. Nothing is written to the database.
 *
 * Writes `<out>/batches/<batch_id>.json` and merges `<out>/manifest.json`.
 * Prints a summary as JSON on stdout. See `.claude/skills/corpus-review`.
 *
 * Usage:
 *   npm run review:batches -- --mod <id> [--mod <id> …] --out <dir> [options]
 *
 * Options:
 *   --target-lang <lang>          Language under review (default: configured target)
 *   --context-provenance <name>   Show lines with this provenance as context only (repeatable)
 *   --prefix <name>               Batch id prefix (one mod only; default: slug of the mod name)
 *
 * Examples:
 *   npm run review:batches -- --mod 120 --out /tmp/review-ss2
 *   npm run review:batches -- --mod 104 --mod 105 --out /tmp/review --context-provenance tm_fo4_final_review
 */
import '../src/loadEnv';
// Registers the game plugins; families, dialogue and the name canon come from them.
import '../src/games';
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { buildModBatches } from '../src/review/buildBatches';
import { reviewLineCount } from '../src/review/pack';

const argv = await yargs(hideBin(process.argv))
  .scriptName('review:batches')
  .option('mod', { type: 'number', array: true, demandOption: true })
  .option('out', { type: 'string', demandOption: true })
  .option('target-lang', { type: 'string' })
  .option('context-provenance', { type: 'string', array: true, default: [] as string[] })
  .option('prefix', { type: 'string' })
  .check((a) => !(a.prefix && a.mod.length > 1) || 'Use --prefix with a single --mod')
  .help()
  .parse();

type ManifestEntry = {
  id: string;
  mod_id: number;
  family: string;
  lines: number;
  review: number;
  units: number;
};

validateConfig();
const db = openDb();
const batchDir = path.join(argv.out, 'batches');
fs.mkdirSync(batchDir, { recursive: true });
const manifestFile = path.join(argv.out, 'manifest.json');
let manifest: ManifestEntry[] = fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  : [];

try {
  const summary = [];
  for (const modId of argv.mod) {
    const { mod, batches } = await buildModBatches(db, {
      modId,
      srcLang: CONFIG.defaultSrcLang,
      targetLang: argv['target-lang'] ?? CONFIG.defaultTgtLang,
      contextProvenances: new Set(argv['context-provenance']),
      prefix: argv.prefix,
      onProgress: (scope, done, total) => {
        if (done % 500 === 0) process.stderr.write(`mod ${modId} ${scope}: ${done}/${total}\n`);
      },
    });
    manifest = manifest.filter((m) => m.mod_id !== mod.id);
    for (const batch of batches) {
      fs.writeFileSync(
        path.join(batchDir, `${batch.batch_id}.json`),
        JSON.stringify(batch, null, 1),
      );
      manifest.push({
        id: batch.batch_id,
        mod_id: mod.id,
        family: batch.family,
        lines: batch.units.reduce((n, u) => n + u.lines.length, 0),
        review: reviewLineCount(batch.units),
        units: batch.units.length,
      });
    }
    const mine = manifest.filter((m) => m.mod_id === mod.id);
    const byFamily: Record<string, { batches: number; review: number }> = {};
    for (const m of mine) {
      const f = (byFamily[m.family] ??= { batches: 0, review: 0 });
      f.batches++;
      f.review += m.review;
    }
    summary.push({ mod: mod.name, id: mod.id, batches: mine.length, byFamily });
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
} finally {
  await closeDb();
}
