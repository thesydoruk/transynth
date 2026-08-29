import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { resolveModStoredPath } from '../../../modStorage';
import { PATHS } from '../../../paths';
import { getOrCreateCachedPreviewWav } from './audioCache';
import { resolveLocalizeDir, resolveModVoiceContext, resolveVoicePackageContext } from './context';
import { findLocalizedVoiceAbsPath, findLocalizedVoiceForEntry } from './translationAudioIndex';
import { discoverVoiceEntries, findVoiceEntry } from './voiceEntries';
import { resolveVoiceRootRel } from '../../../voice/discoverVoiceFiles';
import { resolveDiscoVoiceExtractRoot } from '../../../voice/disco/discoverDiscoVoiceFiles';
import { resolveDiscoClipEntryByFormid } from '../../../voice/disco/resolveClipEntry';
import { outputLocalizedWavRelPath } from '../../../voice/disco/voicePaths';
import type { VoiceAudioResult } from './types';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';

const loadModVoiceMeta = async (
  db: Tx,
  modId: number,
): Promise<
  | { ok: false; reason: 'mod_not_found' | 'no_plugin_path'; message: string }
  | { ok: true; absPath: string; isDisco: boolean }
> => {
  const { rows } = await db.query<{ abs_path: string | null; game: string | null }>(
    `SELECT abs_path, game FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = rows[0];
  if (!mod) {
    return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  }
  if (!mod.abs_path) {
    return { ok: false, reason: 'no_plugin_path', message: 'Mod has no plugin path' };
  }
  return {
    ok: true,
    absPath: resolveModStoredPath(mod.abs_path),
    isDisco: (mod.game ?? '').toLowerCase() === 'disco',
  };
};

const resolveVoiceEntry = async (
  db: Tx,
  modId: number,
  meta: { absPath: string; isDisco: boolean },
  formidLower6: string,
  variant: number,
  speakerKey?: string,
): Promise<
  | { ok: true; entry: VoiceFileEntry }
  | { ok: false; reason: 'plugin_missing' | 'line_not_found'; message: string }
> => {
  if (meta.isDisco) {
    const extractRoot = resolveDiscoVoiceExtractRoot(meta.absPath);
    if (!extractRoot) {
      return { ok: false, reason: 'plugin_missing', message: 'Disco pack root not found' };
    }
    const found = await resolveDiscoClipEntryByFormid(db, modId, extractRoot, formidLower6);
    if (!found || found.entry.variant !== variant) {
      return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
    }
    return { ok: true, entry: found.entry };
  }

  const ctx = resolveVoicePackageContext(meta.absPath, CONFIG.defaultTgtLang);
  if (!ctx) {
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  }
  const entry = findVoiceEntry(discoverVoiceEntries(ctx), formidLower6, variant, {
    voiceRootRel: resolveVoiceRootRel(ctx.pluginRel),
    speakerKey,
  });
  if (!entry) {
    return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }
  return { ok: true, entry };
};

/** Resolve or create a cached browser-playable WAV for one voice line. */
export const getVoicePreviewWav = async (
  db: Tx,
  modId: number,
  formidLower6: string,
  variant: number,
  speakerKey?: string,
): Promise<VoiceAudioResult> => {
  const meta = await loadModVoiceMeta(db, modId);
  if (!meta.ok) return meta;

  const resolved = await resolveVoiceEntry(db, modId, meta, formidLower6, variant, speakerKey);
  if (!resolved.ok) return resolved;
  const entry = resolved.entry;
  if (!fs.existsSync(entry.absolutePath)) {
    return { ok: false, reason: 'source_missing', message: 'Voice source file is missing' };
  }

  const cacheDir = path.join(PATHS.voicePreview, String(modId));
  const cached = await getOrCreateCachedPreviewWav(
    entry.absolutePath,
    cacheDir,
    `mod=${modId} ${speakerKey ?? ''} ${formidLower6}_${variant}`,
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
  formidLower6: string,
  variant: number,
  speakerKey?: string,
): Promise<VoiceAudioResult> => {
  const meta = await loadModVoiceMeta(db, modId);
  if (!meta.ok) return meta;

  const resolved = await resolveModVoiceContext(db, modId);
  if (!resolved.ok) return resolved;

  const found = await resolveVoiceEntry(db, modId, meta, formidLower6, variant, speakerKey);
  if (!found.ok) return found;
  const entry = found.entry;

  const localizeDir =
    resolved.ctx.localizeDir ?? resolveLocalizeDir(resolved.ctx, resolved.targetLang);
  const discoLocalized = meta.isDisco
    ? path.join(localizeDir ?? '', outputLocalizedWavRelPath(entry))
    : null;
  const sourcePath =
    discoLocalized && fs.existsSync(discoLocalized)
      ? discoLocalized
      : meta.isDisco
        ? findLocalizedVoiceAbsPath(localizeDir, formidLower6, variant, { disco: true })
        : findLocalizedVoiceForEntry(localizeDir, entry);
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
    `translation mod=${modId} ${speakerKey ?? ''} ${formidLower6}_${variant}`,
  );
  if (!cached.ok) {
    return { ok: false, reason: 'convert_failed', message: cached.message };
  }
  return { ok: true, wavPath: cached.wavPath };
};
