#!/usr/bin/env tsx
/**
 * Regenerate LIP/XWM for existing localized voice `.fuz` files (no TTS).
 * Loudness matching now happens on the TTS server against the first speaker_wav.
 *
 * Usage:
 *   npx tsx scripts/rebuildVoiceLoudness.ts --mod-id 1
 *   npx tsx scripts/rebuildVoiceLoudness.ts --mod-id 1 --concurrency 8 --limit 50
 *   npx tsx scripts/rebuildVoiceLoudness.ts --mod-id 1 --force
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import {
  REBUILD_VOICE_LOUDNESS_CONCURRENCY,
  REBUILD_VOICE_LOUDNESS_TIMEOUT_MS,
  rebuildModVoiceLoudness,
} from '../src/voice/rebuildModVoiceLoudness';

const argv = await yargs(hideBin(process.argv))
  .option('mod-id', { type: 'number', demandOption: true, describe: 'Mod id' })
  .option('tgt-lang', { type: 'string', describe: 'Target language (default: project/uk)' })
  .option('concurrency', {
    type: 'number',
    default: REBUILD_VOICE_LOUDNESS_CONCURRENCY,
    describe: 'Parallel rebuild workers',
  })
  .option('timeout-ms', {
    type: 'number',
    default: REBUILD_VOICE_LOUDNESS_TIMEOUT_MS,
    describe: 'Per-file timeout in milliseconds',
  })
  .option('limit', { type: 'number', describe: 'Max files to process' })
  .option('force', { type: 'boolean', default: false, describe: 'Rebuild even if version current' })
  .option('dry-run', { type: 'boolean', default: false, describe: 'Count work only' })
  .strict()
  .help()
  .parse();

const db = openDb();
try {
  const result = await rebuildModVoiceLoudness(db, {
    modId: argv.modId,
    tgtLang: argv.tgtLang,
    concurrency: argv.concurrency,
    timeoutMs: argv.timeoutMs,
    limit: argv.limit,
    force: argv.force,
    dryRun: argv.dryRun,
  });
  log.info('Voice loudness rebuild finished', result);
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await closeDb();
}
