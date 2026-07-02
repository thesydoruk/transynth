#!/usr/bin/env tsx
/**
 * Download Champollion into `data/tools/champollion` for PEX source hints in the mod editor.
 *
 * Installs Champollion v1.3.2 from GitHub releases. The server uses
 * `data/tools/champollion/Champollion.exe` automatically when CHAMPOLLION_PATH is unset.
 *
 * Usage:
 *   npm run tools:champollion
 *   npm run tools:champollion -- --force
 *
 * Options:
 *   --force   Re-download and reinstall even when the same version is already present
 */
import '../src/loadEnv';
import { installChampollion } from '../src/tools/installChampollion';
import { log } from '../src/logger';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const main = async (): Promise<void> => {
  const argv = await yargs(hideBin(process.argv))
    .option('force', {
      type: 'boolean',
      default: false,
      description: 'Reinstall even when the bundled version is already present',
    })
    .help()
    .parse();

  const result = await installChampollion({ force: argv.force });
  if (result.skipped) {
    log.info(`Champollion ${result.version} already installed at ${result.exePath}`);
    return;
  }

  log.info(`Installed Champollion ${result.version} → ${result.exePath}`);
};

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
