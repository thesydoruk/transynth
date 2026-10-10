#!/usr/bin/env tsx
/**
 * Write a Witcher 3 mod's synthesized voice as speech files the game loads.
 *
 * Usage:
 *   npm run w3:voice-pack -- --mod <id> --out <dir> [--lang uk] [--slot br]
 *
 * For every source container the mod imported, writes
 * `<dir>/<content folder>/<slot>pc.w3speech`: the original lines with the
 * synthesized ones swapped in. Copy the files into the game's same folders and
 * pick the slot's voice language in the game's language menu (Brazilian
 * Portuguese for the default slot) — or set `SpeechLanguage=BR` under
 * `[Localization]` in `Documents/The Witcher 3/user.settings`.
 *
 * The files hold the game's own audio for every line not replaced, so they are
 * for the player's own install, not for redistribution.
 */
import '../../index';
import '../../../loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../../../config';
import { closeDb, openDb } from '../../../db';
import { log } from '../../../logger';
import { loadImportedMod } from '../../../modImport/importedMod';
import {
  modImportLocalizeDir,
  resolveModImportExtractRoot,
  resolveModStoredPath,
} from '../../../modStorage';
import { closeLipsyncPool } from '../mimic/lipsyncPool';
import { buildW3VoicePack, W3_DEFAULT_VOICE_SLOT } from './pack';
import { loadW3MimicModel, w3MimicModelPath } from './mimicModel';

const argv = await yargs(hideBin(process.argv))
  .option('mod', { type: 'number', demandOption: true, describe: 'Mod id' })
  .option('out', { type: 'string', demandOption: true, describe: 'Output directory' })
  .option('lang', {
    type: 'string',
    default: CONFIG.defaultTgtLang,
    describe: 'Target language of the takes',
  })
  .option('slot', {
    type: 'string',
    default: W3_DEFAULT_VOICE_SLOT,
    describe: 'Voice slot to write as',
  })
  .help()
  .parse();

const db = openDb();
try {
  const mod = await loadImportedMod(db, argv.mod);
  if (mod.game !== 'w3') throw new Error(`Mod ${argv.mod} is not a Witcher 3 mod (${mod.game})`);
  const { rows } = await db.query<{ abs_path: string | null }>(
    `SELECT abs_path FROM mods WHERE id = $1`,
    [argv.mod],
  );
  const anchor = rows[0]?.abs_path ? resolveModStoredPath(rows[0].abs_path) : null;
  const extractRoot = anchor ? resolveModImportExtractRoot(anchor) : null;
  if (!extractRoot) throw new Error(`Mod ${argv.mod} has no extracted files on disk`);
  const model = loadW3MimicModel();
  log.info(
    `Mouth animation for stale takes: ${model ? `model ${w3MimicModelPath()}` : 'original, stretched'}`,
  );
  const files = await buildW3VoicePack({
    extractRoot,
    localizeDir: modImportLocalizeDir(extractRoot, argv.lang),
    outDir: argv.out,
    sourceLang: mod.srcLang,
    slot: argv.slot,
    model,
    modelPath: model ? w3MimicModelPath() : null,
    onProgress: (message) => log.info(message),
  });
  if (files.length === 0) log.warn('No synthesized takes to pack — run the voice job first.');
  for (const file of files) log.info(`Wrote ${file.relPath}: ${file.replaced}/${file.lines} lines`);
} finally {
  await closeDb();
  closeLipsyncPool();
}
