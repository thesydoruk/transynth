#!/usr/bin/env tsx
/**
 * Unpack Bethesda `.fuz` voice files into `.lip`, `.xwm`, and `.wav`.
 *
 * Usage:
 *   npm run fuz:unpack -- --dir <folder-with-fuz>
 *   npm run fuz:unpack -- --dir <folder> --out <output-folder> --concurrency 8
 *   npm run fuz:unpack -- --dir <folder> --no-wav
 */
import '../src/loadEnv';
import os from 'node:os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { unpackFuzDir } from '../src/formats/fuz/unpackFuzDir';
import { log } from '../src/logger';
import { resolveDirectoryInput } from '../src/utils/file';

const argv = await yargs(hideBin(process.argv))
  .scriptName('fuz:unpack')
  .usage('$0 --dir <folder> [options]')
  .option('dir', {
    type: 'string',
    demandOption: true,
    describe: 'Folder containing .fuz files',
  })
  .option('out', {
    type: 'string',
    describe: 'Output folder (default: sibling {name}_unpacked)',
  })
  .option('concurrency', {
    type: 'number',
    default: Math.min(8, os.cpus().length || 4),
    describe: 'Parallel ffmpeg jobs for WAV conversion',
  })
  .option('no-wav', {
    type: 'boolean',
    default: false,
    describe: 'Skip XWM → WAV conversion (lip + xwm only)',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Overwrite existing extracted files',
  })
  .help()
  .parse();

const srcDir = resolveDirectoryInput(argv.dir);

const result = await unpackFuzDir({
  srcDir,
  outDir: argv.out?.trim() || undefined,
  wav: !argv['no-wav'],
  concurrency: argv.concurrency,
  force: argv.force,
});

log.info(
  `Unpacked ${result.fuzCount} FUZ → ${result.outDir} (${result.extracted} new, ${result.skipped} skipped, ${result.wavCount} wav)`,
);

if (result.failed.length > 0) {
  for (const item of result.failed) {
    log.error(`${item.file}: ${item.error}`);
  }
  process.exitCode = 1;
}
