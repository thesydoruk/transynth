#!/usr/bin/env tsx
/**
 * Write reviewed translation edits from a JSON file, guarded by the old text.
 *
 * A line is written only if its stored translation is still exactly `old`;
 * otherwise it is reported as stale and left alone. Each write records a
 * revision, refreshes the line's QA issues and drops its RAG example (run
 * `npm run rag:index-missing` afterwards). Changed voiced lines are picked up
 * by the next `missing` voice job on their own.
 *
 * The file holds `[{ id, old, new, note? }]`, where `id` is the source string
 * id, or an object with that list under `fixes` or `ok` (review batch files).
 * The result is printed as JSON on stdout.
 *
 * Usage:
 *   npm run translations:apply -- <file> [options]
 *
 * Options:
 *   --target-lang <lang>   Language to write (default: configured target)
 *   --status <status>      reviewed | human | draft (default: reviewed)
 *   --provenance <name>    Provenance of the new text (default: human_edit)
 *   --model <name>         Model that wrote the text, if any
 *   --dry-run              Classify only, write nothing
 *
 * Examples:
 *   npm run translations:apply -- /tmp/fixes.json --dry-run
 *   npm run translations:apply -- /tmp/fixes.json --provenance agent_review --model claude-opus-5-5
 */
import '../src/loadEnv';
// Registers the game plugins; the QA rules look up the game's glossary key through the registry.
import '../src/games';
import fs from 'node:fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { applyTranslationFixes, type TranslationFix } from '../src/web/data/queries';

const STATUSES = ['reviewed', 'human', 'draft'] as const;

const argv = await yargs(hideBin(process.argv))
  .scriptName('translations:apply')
  .usage('$0 <file> [options]')
  .demandCommand(1, 'Pass the fixes file')
  .option('target-lang', { type: 'string', describe: 'Language to write' })
  .option('status', { choices: STATUSES, default: 'reviewed' as const })
  .option('provenance', { type: 'string', default: 'human_edit' })
  .option('model', { type: 'string' })
  .option('dry-run', { type: 'boolean', default: false })
  .help()
  .parse();

const readFixes = (file: string): TranslationFix[] => {
  const json: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(json)
    ? json
    : ((json as { fixes?: unknown; ok?: unknown }).fixes ?? (json as { ok?: unknown }).ok);
  if (!Array.isArray(list)) throw new Error(`${file}: expected a list, or one under "fixes"/"ok"`);
  return list.map((item: Record<string, unknown>, i) => {
    if (
      !Number.isInteger(item.id) ||
      typeof item.old !== 'string' ||
      typeof item.new !== 'string'
    ) {
      throw new Error(`${file}: entry ${i} needs an integer id and string old/new`);
    }
    const note = [item.reason, item.note].filter((v) => typeof v === 'string' && v).join(': ');
    return { id: item.id as number, old: item.old, new: item.new, note: note || undefined };
  });
};

validateConfig();
const db = openDb();

try {
  const result = await applyTranslationFixes(db, readFixes(String(argv._[0])), {
    targetLang: argv['target-lang'] ?? CONFIG.defaultTgtLang,
    status: argv.status,
    provenance: argv.provenance,
    model: argv.model ?? null,
    dryRun: argv['dry-run'],
  });
  const summary = {
    dryRun: argv['dry-run'],
    applied: result.applied.length,
    unchanged: result.unchanged.length,
    stale: result.stale,
    rejected: result.rejected,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
} finally {
  await closeDb();
}
