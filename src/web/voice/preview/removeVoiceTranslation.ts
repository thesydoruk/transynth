/**
 * Remove the synthesized take of one line in one language — what "Clear" in the
 * voice editor does on top of clearing the text.
 *
 * Only the mod's own localize tree for that language is touched: the source
 * take (the mod's or, for a line it overrides, the master's), a master's own
 * dub, takes of other languages and the reference voice store all live
 * elsewhere and stay. A line the mod inherits from a master is dubbed into this
 * mod's tree, so its take here is the mod's own as well.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../../db';
import type { GameVoiceAdapter } from '../../../games/contract';
import { toDiskPath } from '../../../modImport';
import { modImportLocalizeDir, resolveModImportExtractRoot } from '../../../modStorage';
import { PATHS } from '../../../paths';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import { removeVoiceTake } from '../../../voice/takeSidecars';
import { normalizeVoiceOrigin, originFromVoiceRelPath } from '../../../voice/voiceOrigin';
import {
  deleteVoiceSynthesisStamp,
  speakerKeyFromVoiceRelPath,
} from '../../../voice/voiceSynthesisState';
import { removeCachedPreviewWav } from './audioCache';
import { packageLocalizeDir, resolveModVoiceContext, type VoicePackageContext } from './context';
import { loadModVoiceMeta, resolveVoiceEntry } from './previewWav';
import { findLocalizedVoiceForEntry } from './translationAudioIndex';
import type { VoiceRemoveLineResult } from './types';

/** Extensions {@link findLocalizedVoiceForEntry} tries; bounds the loop below. */
const MIRRORED_TAKE_KINDS = 3;

/** `target` is `root` itself or below it. */
const isWithin = (root: string, target: string): boolean => {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** `target` is strictly below `root`. */
const isBelow = (root: string, target: string): boolean =>
  isWithin(root, target) && path.resolve(root) !== path.resolve(target);

/**
 * The trees that may hold this mod's take in `targetLang`: the one the editor
 * lists from and the one single-line synthesis writes to (the same directory
 * for almost every mod). Either must sit under the mod's own
 * `_localize_{key}/{targetLang}/`; a tree of the import's other language, which
 * the editor may fall back to for listing, does not qualify.
 */
export const voiceLocalizeDirsFor = (ctx: VoicePackageContext, targetLang: string): string[] => {
  const extractRoot = resolveModImportExtractRoot(ctx.pluginPath);
  if (!extractRoot) return [];
  const allowed = modImportLocalizeDir(extractRoot, targetLang);
  const dirs = new Set<string>();
  for (const dir of [ctx.localizeDir, packageLocalizeDir(ctx, targetLang)]) {
    if (!dir || !fs.existsSync(dir)) continue;
    if (!isWithin(allowed, dir) || isWithin(ctx.packageDir, dir)) continue;
    dirs.add(path.resolve(dir));
  }
  return [...dirs];
};

/**
 * Delete one line's take from one localize tree: the file at the path synthesis
 * writes, then any copy an older run left at the mirrored path under another
 * extension (the editor counts those as dubbed too). Sidecars go with each take
 * and so does its cached browser copy in `previewCacheDir`. Nothing outside
 * `localizeDir` is deleted. Returns how many takes were there.
 */
export const removeLocalizedTakeFiles = (opts: {
  localizeDir: string;
  takeRelPath: string;
  entry: { relPath: string };
  sidecarExtensions: readonly string[];
  previewCacheDir: string;
}): number => {
  const removeOne = (takePath: string): boolean => {
    if (!isBelow(opts.localizeDir, takePath)) return false;
    removeCachedPreviewWav(takePath, opts.previewCacheDir);
    return removeVoiceTake(takePath, opts.sidecarExtensions);
  };

  let removed = removeOne(toDiskPath(opts.localizeDir, opts.takeRelPath)) ? 1 : 0;
  for (let attempt = 0; attempt < MIRRORED_TAKE_KINDS; attempt += 1) {
    const older = findLocalizedVoiceForEntry(opts.localizeDir, opts.entry);
    if (!older || !removeOne(older)) break;
    removed += 1;
  }
  return removed;
};

/**
 * Remove the synthesized take of one line for one target language: its files,
 * its synthesis stamp and its cached preview. Idempotent — a line without a
 * take answers ok with nothing removed.
 */
export const removeVoiceTranslationForMod = async (
  db: Tx,
  modId: number,
  lineKey: string,
  variant: number,
  srcLang: string,
  targetLang: string,
  speakerKey?: string,
  originPlugin?: string | null,
): Promise<VoiceRemoveLineResult> => {
  const meta = await loadModVoiceMeta(db, modId);
  if (!meta.ok) return meta;
  const resolved = await resolveModVoiceContext(db, modId, targetLang);
  if (!resolved.ok) return resolved;

  const found = await resolveVoiceEntry(
    db,
    modId,
    meta,
    lineKey,
    variant,
    speakerKey,
    originPlugin,
    srcLang,
    resolved.targetLang,
  );
  if (!found.ok) return found;

  const removed = await removeTakeOfVoiceEntry(db, {
    modId,
    voice: meta.voice,
    ctx: resolved.ctx,
    targetLang: resolved.targetLang,
    entry: found.entry,
    speakerKey,
    originPlugin,
  });
  return { ok: true, ...removed };
};

/**
 * The same removal for a take already resolved — one line's files in the mod's
 * trees for `targetLang`, and its stamp. For callers that walk a whole catalog
 * and would otherwise look every line up again.
 */
export const removeTakeOfVoiceEntry = async (
  db: Tx,
  opts: {
    modId: number;
    voice: Pick<GameVoiceAdapter, 'localizedTakeRelPath' | 'takes'>;
    ctx: VoicePackageContext;
    targetLang: string;
    entry: VoiceFileEntry;
    speakerKey?: string | null;
    originPlugin?: string | null;
  },
): Promise<{ takesRemoved: number; stampsRemoved: number }> => {
  const takeRelPath = opts.voice.localizedTakeRelPath(opts.entry);
  const previewCacheDir = path.join(PATHS.voicePreview, String(opts.modId), 'translation');
  let takesRemoved = 0;
  for (const localizeDir of voiceLocalizeDirsFor(opts.ctx, opts.targetLang)) {
    takesRemoved += removeLocalizedTakeFiles({
      localizeDir,
      takeRelPath,
      entry: opts.entry,
      sidecarExtensions: opts.voice.takes?.sidecarExtensions ?? [],
      previewCacheDir,
    });
  }

  // Keyed exactly as synthesis stamps the take it writes at this path.
  const stampsRemoved = await deleteVoiceSynthesisStamp(db, {
    modId: opts.modId,
    lineKey: opts.entry.lineKey,
    variant: opts.entry.variant,
    targetLang: opts.targetLang,
    speakerKey: opts.speakerKey?.trim() || speakerKeyFromVoiceRelPath(takeRelPath),
    originPlugin: originFromVoiceRelPath(takeRelPath) ?? normalizeVoiceOrigin(opts.originPlugin),
  });
  return { takesRemoved, stampsRemoved };
};
