import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../../db';
import { gamePlugin } from '../../../games/registry';
import type { GameVoiceAdapter } from '../../../games/contract';
import { resolveModStoredPath } from '../../../modStorage';
import { PATHS } from '../../../paths';
import { getOrCreateCachedPreviewWav } from './audioCache';
import { resolveLocalizeDir, resolveModVoiceContext } from './context';
import { findLocalizedVoiceForEntry } from './translationAudioIndex';
import type { VoiceAudioResult } from './types';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';

type ModVoiceMeta =
  | { ok: false; reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing'; message: string }
  | { ok: true; absPath: string; voice: GameVoiceAdapter };

const loadModVoiceMeta = async (db: Tx, modId: number): Promise<ModVoiceMeta> => {
  const { rows } = await db.query<{ abs_path: string | null; game: string | null }>(
    `SELECT abs_path, game FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = rows[0];
  if (!mod) return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  if (!mod.abs_path) {
    return { ok: false, reason: 'no_plugin_path', message: 'Mod has no plugin path' };
  }

  const voice = gamePlugin(mod.game).voice;
  if (!voice) {
    return { ok: false, reason: 'plugin_missing', message: 'This game has no voice support' };
  }
  return { ok: true, absPath: resolveModStoredPath(mod.abs_path), voice };
};

const resolveVoiceEntry = async (
  db: Tx,
  modId: number,
  meta: { absPath: string; voice: GameVoiceAdapter },
  lineKey: string,
  variant: number,
  speakerKey?: string,
): Promise<
  { ok: true; entry: VoiceFileEntry } | { ok: false; reason: 'line_not_found'; message: string }
> => {
  const entry = await meta.voice.findLineEntry(db, {
    modId,
    pluginPath: meta.absPath,
    lineKey,
    variant,
    speakerKey,
  });
  return entry
    ? { ok: true, entry }
    : { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
};

/** Resolve or create a cached browser-playable WAV for one voice line. */
export const getVoicePreviewWav = async (
  db: Tx,
  modId: number,
  lineKey: string,
  variant: number,
  speakerKey?: string,
): Promise<VoiceAudioResult> => {
  const meta = await loadModVoiceMeta(db, modId);
  if (!meta.ok) return meta;

  const resolved = await resolveVoiceEntry(db, modId, meta, lineKey, variant, speakerKey);
  if (!resolved.ok) return resolved;
  const entry = resolved.entry;
  if (!fs.existsSync(entry.absolutePath)) {
    return { ok: false, reason: 'source_missing', message: 'Voice source file is missing' };
  }

  const cacheDir = path.join(PATHS.voicePreview, String(modId));
  const cached = await getOrCreateCachedPreviewWav(
    entry.absolutePath,
    cacheDir,
    `mod=${modId} ${speakerKey ?? ''} ${lineKey}_${variant}`,
  );
  if (!cached.ok) {
    return { ok: false, reason: 'convert_failed', message: cached.message };
  }
  return { ok: true, wavPath: cached.wavPath };
};

/** Stream a synthesized translation as browser-playable WAV. */
export const getVoiceTranslationWav = async (
  db: Tx,
  modId: number,
  lineKey: string,
  variant: number,
  speakerKey?: string,
): Promise<VoiceAudioResult> => {
  const meta = await loadModVoiceMeta(db, modId);
  if (!meta.ok) return meta;

  const resolved = await resolveModVoiceContext(db, modId);
  if (!resolved.ok) return resolved;

  const found = await resolveVoiceEntry(db, modId, meta, lineKey, variant, speakerKey);
  if (!found.ok) return found;
  const entry = found.entry;

  const localizeDir =
    resolved.ctx.localizeDir ?? resolveLocalizeDir(resolved.ctx, resolved.targetLang);
  // The take usually sits at the exact path the synthesizer wrote it to; the
  // mirrored-tree lookup is the fallback for takes written by an older run.
  const expected = localizeDir
    ? path.join(localizeDir, meta.voice.localizedTakeRelPath(entry))
    : null;
  const sourcePath =
    expected && fs.existsSync(expected) ? expected : findLocalizedVoiceForEntry(localizeDir, entry);
  if (!sourcePath) {
    return {
      ok: false,
      reason: 'translation_not_generated',
      message: 'Translation audio has not been generated yet',
    };
  }

  if (path.extname(sourcePath).toLowerCase() === '.wav') {
    return { ok: true, wavPath: sourcePath };
  }

  const cacheDir = path.join(PATHS.voicePreview, String(modId), 'translation');
  const cached = await getOrCreateCachedPreviewWav(
    sourcePath,
    cacheDir,
    `translation mod=${modId} ${speakerKey ?? ''} ${lineKey}_${variant}`,
  );
  if (!cached.ok) {
    return { ok: false, reason: 'convert_failed', message: cached.message };
  }
  return { ok: true, wavPath: cached.wavPath };
};
