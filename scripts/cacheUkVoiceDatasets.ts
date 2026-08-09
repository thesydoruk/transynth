#!/usr/bin/env tsx
/**
 * Download full Ukrainian voice corpora into DATA_DIR/uk-voice-cache.
 *
 * Usage:
 *   npm run voice:cache-uk-datasets
 *   npm run voice:cache-uk-datasets -- --opentts-only
 *   npm run voice:cache-uk-datasets -- --cv-only
 *
 * Common Voice requires MDC_API_TOKEN (or a manual extract under the cache dir).
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { log } from '../src/logger';
import { ensureDataDirs } from '../src/paths';
import { cacheUkVoiceDatasets } from '../src/voice/ukLibrary/import/cacheDatasets';

const argv = await yargs(hideBin(process.argv))
  .scriptName('voice:cache-uk-datasets')
  .option('opentts-only', { type: 'boolean', default: false })
  .option('cv-only', { type: 'boolean', default: false })
  .help()
  .parse();

ensureDataDirs();

try {
  const result = await cacheUkVoiceDatasets({
    opentts: !argv['cv-only'],
    commonVoice: !argv['opentts-only'],
  });
  log.info(
    `UK voice cache finished: openttsClips=${result.openttsClips}, commonVoice=${result.commonVoiceDir ?? 'skipped'}`,
  );
} catch (err) {
  log.error(err, 'UK voice cache failed');
  process.exitCode = 1;
}
