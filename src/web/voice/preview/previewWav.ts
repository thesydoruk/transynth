import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { resolveModStoredPath } from '../../../modStorage';
import { resolveLocalizedVoiceAbsPath } from '../../../voice/synthesizeModVoiceLine';
import { PATHS } from '../../../paths';
import { getOrCreateCachedPreviewWav } from './audioCache';
import { resolveLocalizeDir, resolveModVoiceContext, resolveVoicePackageContext } from './context';
import { discoverVoiceEntries, findVoiceEntry } from './voiceEntries';
import type { VoiceAudioResult } from './types';

/** Resolve or create a cached browser-playable WAV for one voice line. */
export const getVoicePreviewWav = async (
  db: Tx,
  modId: number,
  formidLower6: string,
  variant: number,
): Promise<VoiceAudioResult> => {
  const { rows } = await db.query<{ name: string; abs_path: string | null }>(
    `SELECT name, abs_path FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = rows[0];
  if (!mod) {
    return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  }
  if (!mod.abs_path) {
    return { ok: false, reason: 'no_plugin_path', message: 'Mod has no plugin path' };
  }

  const pluginPath = resolveModStoredPath(mod.abs_path);
  const ctx = resolveVoicePackageContext(pluginPath, CONFIG.defaultTgtLang);
  if (!ctx) {
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  }

  const entry = findVoiceEntry(discoverVoiceEntries(ctx), formidLower6, variant);
  if (!entry) {
    return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }
  if (!fs.existsSync(entry.absolutePath)) {
    return { ok: false, reason: 'source_missing', message: 'Voice source file is missing' };
  }

  const cacheDir = path.join(PATHS.voicePreview, String(modId));
  const cached = await getOrCreateCachedPreviewWav(
    entry.absolutePath,
    cacheDir,
    `mod=${modId} ${formidLower6}_${variant}`,
  );
  if (!cached.ok) {
    return { ok: false, reason: 'convert_failed', message: cached.message };
  }
  return { ok: true, wavPath: cached.wavPath };
};

/** Stream a synthesized translation as browser-playable WAV (converts stored `.fuz` on demand). */
export const getVoiceTranslationWav = async (
  db: Tx,
  modId: number,
  formidLower6: string,
  variant: number,
): Promise<VoiceAudioResult> => {
  const resolved = await resolveModVoiceContext(db, modId);
  if (!resolved.ok) return resolved;

  const entry = findVoiceEntry(discoverVoiceEntries(resolved.ctx), formidLower6, variant);
  if (!entry) {
    return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }

  const localizeDir = resolveLocalizeDir(resolved.ctx, resolved.targetLang);
  const sourcePath = localizeDir ? resolveLocalizedVoiceAbsPath(localizeDir, entry) : null;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
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
    `translation mod=${modId} ${formidLower6}_${variant}`,
  );
  if (!cached.ok) {
    return { ok: false, reason: 'convert_failed', message: cached.message };
  }
  return { ok: true, wavPath: cached.wavPath };
};
