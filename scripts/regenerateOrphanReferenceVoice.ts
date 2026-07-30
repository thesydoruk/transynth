#!/usr/bin/env tsx
/**
 * Re-voice lines that were synthesized from an orphan reference clip — shipped
 * audio with no dialogue record, so TTS got another line's transcript. Stale
 * speaker picks are dropped, then the affected lines are synthesized again.
 *
 * Usage:
 *   npx tsx scripts/regenerateOrphanReferenceVoice.ts --dry-run
 *   npx tsx scripts/regenerateOrphanReferenceVoice.ts
 *   npx tsx scripts/regenerateOrphanReferenceVoice.ts --mod-id 101 --mod-id 32
 *   npx tsx scripts/regenerateOrphanReferenceVoice.ts --skip-synthesis
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { regenerateOrphanReferenceVoice } from '../src/voice/orphanReference/regenerateOrphanReferenceVoice';

const argv = await yargs(hideBin(process.argv))
  .option('mod-id', {
    type: 'number',
    array: true,
    describe: 'Limit to these mod ids (default: every mod with a saved speaker reference)',
  })
  .option('tgt-lang', { type: 'string', describe: 'Target language (default: import/project)' })
  .option('reference-mode', {
    choices: ['line', 'speaker'] as const,
    describe: 'Reference mode used when the lines were generated (default: project setting)',
  })
  .option('limit', { type: 'number', describe: 'Max lines to re-synthesize per mod' })
  .option('skip-synthesis', {
    type: 'boolean',
    default: false,
    describe: 'Drop stale picks only, leave TTS to a later voice job',
  })
  .option('dry-run', { type: 'boolean', default: false, describe: 'Report findings only' })
  .strict()
  .help()
  .parse();

const db = openDb();
try {
  const result = await regenerateOrphanReferenceVoice(db, {
    modIds: argv.modId,
    targetLang: argv.tgtLang,
    referenceMode: argv.referenceMode,
    limit: argv.limit,
    skipSynthesis: argv.skipSynthesis,
    dryRun: argv.dryRun,
  });

  for (const mod of result.mods) {
    if (mod.error) {
      log.warn(`mod ${mod.modId}: ${mod.error}`);
      continue;
    }
    if (mod.speakers.length === 0) continue;
    log.info(
      `mod ${mod.modId} "${mod.modName}": ${mod.speakers.join(', ')} — ${mod.lineCount} line(s), written=${mod.written}, failed=${mod.failed}`,
    );
  }
  log.info('Orphan reference voice regeneration finished', {
    totalSpeakers: result.totalSpeakers,
    totalLines: result.totalLines,
    totalWritten: result.totalWritten,
  });
  if (result.mods.some((mod) => mod.error || mod.failed > 0)) process.exitCode = 1;
} finally {
  await closeDb();
}
