#!/usr/bin/env tsx
/**
 * Copy `FonixData.cdf` into data/tools/voice for the bethesda-tools sidecar, and the
 * Starfield Creation Kit's lip tools into data/tools/voice/starfield when the folder
 * given has them.
 *
 * Bethesda ships the Fonix phoneme data and the Starfield `Tools/LipGenerator` and
 * `Tools/FaceFX` folders with the games and their Creation Kits and none of it is
 * redistributed, so it is copied from an install. FaceFXWrapper and xWMAEncode are
 * baked into the bethesda-tools image; ffmpeg is the distro package.
 *
 * Usage:
 *   npm run tools:install -- --game-dir /path/to/Fallout4   (or the Creation Kit)
 *   npm run tools:install -- --game-dir /path/to/Starfield  (with its Creation Kit)
 *   npm run tools:install -- --force
 *
 * Options:
 *   --force     Copy again even when the files are already present
 *   --game-dir  Game / Creation Kit install; CREATION_KIT_DIR and FONIX_DATA_PATH also work
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
    description: 'Copy FonixData.cdf and the Starfield lip tools again even when present',
  })
  .option('game-dir', {
    type: 'string',
    describe:
      'Game or Creation Kit install directory holding FonixData.cdf or Starfield Tools/LipGenerator',
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

  const { starfield } = result;
  if (starfield.skipped) {
    log.info(`Starfield lip tools already in ${starfield.installDir}`);
  } else if (starfield.source) {
    log.info(`Starfield lip tools: ${starfield.copied} files → ${starfield.installDir}`);
  } else {
    log.info(
      'Starfield lip tools not found (optional) — for Starfield pass --game-dir <Starfield with its Creation Kit>',
    );
  }
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
