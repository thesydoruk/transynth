#!/usr/bin/env tsx
/**
 * Check review fixes against their batches before anything is written.
 *
 * Reads `<dir>/batches/<id>.json` and `<dir>/fixes/<id>.json`, writes
 * `<dir>/fixes/<id>.checked.json` with `ok` and `rejected` (each with reasons),
 * and prints one JSON summary line per batch. The `ok` list is what
 * `npm run translations:apply` takes. Offline: no database.
 *
 * Usage:
 *   npm run review:validate -- --dir <dir> <batch_id> [<batch_id> …]
 *   npm run review:validate -- --dir <dir> --all
 */
// Registers the game plugins; token checks read the game's function keywords.
import '../src/games';
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { isGameId } from '../src/games/registry';
import type { ReviewBatch, ReviewFixFile } from '../src/review/types';
import { validateFixes } from '../src/review/validate';

const argv = await yargs(hideBin(process.argv))
  .scriptName('review:validate')
  .usage('$0 --dir <dir> <batch_id…> | --all')
  .option('dir', { type: 'string', demandOption: true })
  .option('all', { type: 'boolean', default: false })
  .help()
  .parse();

const fixesDir = path.join(argv.dir, 'fixes');
const ids = argv.all
  ? fs
      .readdirSync(fixesDir)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.checked.json'))
      .map((f) => f.replace(/\.json$/, ''))
  : argv._.map(String);

let failed = false;
for (const id of ids) {
  const fixFile = path.join(fixesDir, `${id}.json`);
  if (!fs.existsSync(fixFile)) {
    process.stdout.write(`${JSON.stringify({ id, missing: true })}\n`);
    continue;
  }
  let fixes: ReviewFixFile;
  try {
    fixes = JSON.parse(fs.readFileSync(fixFile, 'utf8'));
  } catch (err) {
    failed = true;
    process.stdout.write(`${JSON.stringify({ id, parseError: String(err) })}\n`);
    continue;
  }
  const batch: ReviewBatch = JSON.parse(
    fs.readFileSync(path.join(argv.dir, 'batches', `${id}.json`), 'utf8'),
  );
  const checked = validateFixes(batch, fixes, isGameId(batch.game) ? batch.game : null);
  fs.writeFileSync(path.join(fixesDir, `${id}.checked.json`), JSON.stringify(checked, null, 1));
  const lines = batch.units.reduce((n, u) => n + u.lines.length, 0);
  process.stdout.write(
    `${JSON.stringify({ id, lines, fixes: fixes.fixes?.length ?? 0, ok: checked.ok.length, rejected: checked.rejected.length })}\n`,
  );
}
if (failed) process.exitCode = 1;
