#!/usr/bin/env tsx
/**
 * Install bundled external tools used by the localization pipeline.
 *
 * Components:
 *   - Champollion (PEX decompilation)
 *   - FaceFXWrapper (fresh LIP generation)
 *   - FonixData.cdf + xWMAEncode.exe (game copy, or xWMAEncode from Microsoft DirectX SDK download)
 *   - ffmpeg (Windows static build when not on PATH)
 *
 * Usage:
 *   npm run tools:install
 *   npm run tools:install -- --force
 *   npm run tools:install -- --game-dir "C:\Program Files (x86)\Steam\steamapps\common\Fallout 4"
 *
 * Options:
 *   --force     Reinstall even when the bundled versions are already present
 *   --game-dir  Fallout 4 / Creation Kit install (FonixData.cdf, xWMAEncode.exe)
 */
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
    description: 'Reinstall all bundled tools',
  })
  .option('game-dir', {
    type: 'string',
    describe: 'Game install directory (FonixData.cdf, xWMAEncode.exe)',
  })
  .help()
  .parse();

try {
  const result = await installTools({
    force: argv.force,
    gameDir: argv['game-dir'],
  });

  if (result.champollion.skipped) {
    log.info(`Champollion ${result.champollion.version} already installed`);
  } else {
    log.info(`Installed Champollion ${result.champollion.version} → ${result.champollion.exePath}`);
  }

  if (result.voice.skipped) {
    log.info(`Voice tools already installed in ${result.voice.installDir}`);
  } else {
    log.info(`Installed voice tools → ${result.voice.installDir}`);
    log.info(`  FaceFXWrapper: ${result.voice.faceFxPath}`);
    log.info(`  FonixData.cdf: ${result.voice.fonixPath}`);
    log.info(`  xWMAEncode:    ${result.voice.xwmaPath}`);
    log.info(`  ffmpeg:        ${result.voice.ffmpegPath}`);
  }

  for (const warning of result.voice.warnings) {
    log.warn(warning);
  }
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
