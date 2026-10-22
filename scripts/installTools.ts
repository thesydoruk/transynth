#!/usr/bin/env tsx
/**
 * Copy `FonixData.cdf` into data/tools/voice for the bethesda-tools sidecar.
 *
 * Bethesda ships the Fonix phoneme data with the game and the Creation Kit and it is not
 * redistributed, so it is copied from an install. FaceFXWrapper and xWMAEncode are baked
 * into the bethesda-tools image; ffmpeg is the distro package.
 *
 * Usage:
 *   npm run tools:install -- --game-dir /path/to/Fallout4   (or the Creation Kit)
 *   npm run tools:install -- --force
 *
 * Options:
 *   --force     Copy again even when FonixData.cdf is already present
 *   --game-dir  Fallout 4 / Creation Kit install; CREATION_KIT_DIR and FONIX_DATA_PATH also work
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { log } from '../src/logger';
import { installTools } from '../src/tools/installTools';

const argv = await yargs(hideBin(process.argv))
  .scriptName('tools:install')
  .option('force', {
    type: 'boolean',
    default: false,
    description: 'Copy FonixData.cdf again even when it is present',
  })
  .option('game-dir', {
    type: 'string',
    describe: 'Game or Creation Kit install directory holding FonixData.cdf',
  })
  .help()
  .parse();

try {
  const result = await installTools({
    force: argv.force,
    gameDir: argv['game-dir'],
  });

  if (result.voice.skipped) {
    log.info(`FonixData.cdf already in ${result.voice.installDir}`);
  } else {
    log.info(`Voice tools dir: ${result.voice.installDir}`);
    log.info(`  FonixData.cdf: ${result.voice.fonixPath}`);
  }

  for (const warning of result.voice.warnings) {
    log.warn(warning);
  }
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
