#!/usr/bin/env tsx
/**
 * Synthesize localized voice lines into `localize/` using XTTS Ukrainian + fresh LIP generation.
 *
 * Pipeline per voiced line:
 *   1. XTTS clone from a reference clip (`speaker` = per NPC, `line` = same English phrase)
 *   2. FaceFXWrapper generates a new LIP from Ukrainian text + synthesized WAV
 *   3. xWMAEncode + FUZE pack → new .fuz (never reuses old lipsync)
 *
 * Requires:
 *   - XTTS service (`docker compose -f docker-compose.xtts-uk.yml up -d`)
 *   - Bundled tools (`npm run tools:install`) or custom paths in .env
 *
 * Usage:
 *   npm run mod:localize-voice -- --workspace <path> [options]
 *   npm run mod:localize-voice -- --working-dir <path> --name <modName> [options]
 */
import '../src/loadEnv';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { localizeModWorkspaceVoice } from '../src/modWorkspace/localizeModWorkspaceVoice';
import type { GameType } from '../src/types';
import { resolveDirectoryInput } from '../src/utils/file';
import { resolveXttsUkBaseUrl, resolveTtsReferenceMode } from '../src/voice/voiceToolPaths';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

const defaultWorkingDir = process.env.MOD_WORKING_DIR?.trim();

const argv = await yargs(hideBin(process.argv))
  .scriptName('mod:localize-voice')
  .usage('$0 --workspace <path> [options]')
  .option('workspace', {
    type: 'string',
    describe: 'Path to mod workspace folder',
  })
  .option('working-dir', {
    type: 'string',
    default: defaultWorkingDir,
    describe: 'Workspace root (with --name)',
  })
  .option('name', {
    type: 'string',
    describe: 'Mod folder name under --working-dir',
  })
  .option('mod-id', {
    type: 'number',
    describe: 'Database mod id',
  })
  .option('src-lang', {
    type: 'string',
    describe: `Source language (default: per-mod import or ${CONFIG.defaultSrcLang})`,
  })
  .option('tgt-lang', {
    type: 'string',
    default: CONFIG.defaultTgtLang,
    describe: 'Target translation language',
  })
  .option('game', {
    choices: [...GAME_CHOICES],
    describe: 'Game override',
  })
  .option('xtts-url', {
    type: 'string',
    default: resolveXttsUkBaseUrl(),
    describe: 'XTTS Ukrainian API base URL',
  })
  .option('limit', {
    type: 'number',
    describe: 'Process at most N voice lines (for testing)',
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'List lines that would be synthesized without calling XTTS',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Rewrite localize files even when unchanged',
  })
  .option('reference-mode', {
    choices: ['speaker', 'line'] as const,
    describe: 'XTTS reference: speaker = one clip per NPC; line = same English phrase per row',
  })
  .option('line-reference', {
    type: 'boolean',
    default: false,
    describe: 'Shorthand for --reference-mode line (same English audio as the voiced line)',
  })
  .option('speaker-reference', {
    type: 'boolean',
    default: resolveTtsReferenceMode() === 'speaker',
    describe: 'Shorthand for --reference-mode speaker (default)',
  })
  .option('no-speaker-reference', {
    type: 'boolean',
    default: false,
    describe: 'Shorthand for --reference-mode line (legacy alias)',
  })
  .check((args) => {
    if (args.workspace?.trim()) return true;
    if (args['working-dir']?.trim() && args.name?.trim()) return true;
    throw new Error('Specify --workspace or both --working-dir and --name');
  })
  .help()
  .parse();

const workspaceDir = argv.workspace?.trim()
  ? path.resolve(argv.workspace)
  : path.join(resolveDirectoryInput(argv['working-dir']!), argv.name!);

if (argv.game && !isGameType(argv.game)) {
  log.error(`Invalid --game value: ${argv.game}`);
  process.exit(1);
}

const db = openDb();

const referenceMode =
  argv['reference-mode'] ??
  (argv['line-reference'] || argv['no-speaker-reference']
    ? 'line'
    : argv['speaker-reference'] === false
      ? 'line'
      : resolveTtsReferenceMode());

try {
  const result = await localizeModWorkspaceVoice(db, {
    workspaceDir,
    modId: argv['mod-id'],
    srcLang: argv['src-lang'],
    tgtLang: argv['tgt-lang'],
    game: argv.game as GameType | undefined,
    xttsBaseUrl: argv['xtts-url'],
    limit: argv.limit,
    dryRun: argv['dry-run'],
    force: argv.force,
    referenceMode,
  });

  log.info(
    `Voice localized "${result.modName}" (id=${result.modId}) → ${result.localizeDir}: ${result.written.length} written, ${result.skipped.length} skipped`,
  );
  for (const rel of result.written) {
    log.info(`  + ${rel}`);
  }
  for (const warning of result.warnings) {
    log.warn(warning);
  }
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  await closeDb();
}
