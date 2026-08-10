import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import { CONFIG } from '../config';
import { log } from '../logger';
import { loadModImportPaths } from '../import/mod/resolvePaths';
import {
  loadImportedMod,
  pluginRelPath,
  resolveImportPackages,
  toDiskPath,
  writeIfChanged,
  type ImportPackageContext,
} from '../modImport';
import { mapWithConcurrency } from '../utils/concurrency';
import { ensureDir } from '../utils/file';
import { extractXwmFromFuzFile } from '../formats/fuz';
import { convertToFo4Wav } from './ffmpegAudio';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { dedupeVoiceFiles, discoverVoiceFiles, type VoiceFileEntry } from './discoverVoiceFiles';
import {
  loadVoiceTranslations,
  lookupVoiceTranslation,
  voiceTranslationMapKey,
} from './loadVoiceTranslations';
import { canSynthesizeVoiceLine, prepareVoiceTtsText } from './prepareVoiceTtsText';
import { effectiveStressedTranslation } from './stressedTranslation';
import { buildVoicedFuzFromTtsWav } from './synthesizeVoicedFuz';
import { outputLocalizedFuzRelPath } from './voiceFilePaths';
import { loadVoiceSynthesisVersionMap, upsertVoiceSynthesisState } from './voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from './voiceTtsPayloadVersion';
import type { GameType } from '../types';

export type RebuildModVoiceLoudnessOptions = {
  modId: number;
  tgtLang?: string;
  /** Parallel FaceFX/ffmpeg workers (default 8). */
  concurrency?: number;
  /** Per-file timeout in ms (default 2 minutes). */
  timeoutMs?: number;
  limit?: number;
  dryRun?: boolean;
  /** Rebuild even when synthesis version already matches. */
  force?: boolean;
};

export type RebuildModVoiceLoudnessResult = {
  modId: number;
  modName: string;
  rebuilt: number;
  skipped: number;
  failed: number;
  warnings: string[];
};

/** Default parallel workers for loudness rebuild. */
export const REBUILD_VOICE_LOUDNESS_CONCURRENCY = 8;

/** Default per-file budget (FaceFX + encode). */
export const REBUILD_VOICE_LOUDNESS_TIMEOUT_MS = 120_000;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}: timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const ukFuzToWavBytes = async (fuzPath: string, workDir: string): Promise<Buffer> => {
  const xwmPath = path.join(workDir, 'uk.src.xwm');
  const wavPath = path.join(workDir, 'uk.src.wav');
  fs.writeFileSync(xwmPath, extractXwmFromFuzFile(fuzPath));
  await convertToFo4Wav(xwmPath, wavPath);
  return fs.readFileSync(wavPath);
};

type WorkItem = {
  entry: VoiceFileEntry;
  pkg: ImportPackageContext;
  translation: string;
  payloadVersion: string;
  fuzDest: string;
};

const collectWork = async (
  db: Tx,
  modId: number,
  packages: ImportPackageContext[],
  srcLang: string,
  tgtLang: string,
  force: boolean,
  limit?: number,
): Promise<WorkItem[]> => {
  const storedVersions = await loadVoiceSynthesisVersionMap(db, modId, tgtLang);
  const translations = await loadVoiceTranslations(db, modId, srcLang, tgtLang);
  const items: WorkItem[] = [];

  for (const pkg of packages) {
    const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
    const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel));

    for (const entry of voiceFiles) {
      if (limit != null && items.length >= limit) return items;
      const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
      if (!row || !canSynthesizeVoiceLine(row.source, row.translation, row.edid)) continue;

      const prepared = prepareVoiceTtsText({
        lineSource: row.source,
        translation: row.translation,
        stressedTranslation: effectiveStressedTranslation(row),
        speakerSource: row.source,
        edid: row.edid,
      });
      if (prepared.action !== 'synthesize') continue;

      const fuzRel = outputLocalizedFuzRelPath(entry);
      const fuzDest = toDiskPath(pkg.localizeDir, fuzRel);
      if (!fs.existsSync(fuzDest)) continue;

      const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
      const stored = storedVersions.get(voiceTranslationMapKey(entry.formidLower6, entry.variant));
      if (!force && isVoiceSynthesisCurrent(stored, payloadVersion, true)) continue;

      items.push({
        entry,
        pkg,
        translation: prepared.text,
        payloadVersion,
        fuzDest,
      });
    }
  }
  return items;
};

const rebuildOne = async (
  db: Tx,
  modId: number,
  game: GameType,
  tgtLang: string,
  item: WorkItem,
  dryRun: boolean,
  timeoutMs: number,
): Promise<'rebuilt' | 'skipped' | 'failed'> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-loud-rebuild-'));
  try {
    await withTimeout(
      (async () => {
        const workDir = path.join(tempRoot, `${item.entry.formidLower6}_${item.entry.variant}`);
        ensureDir(workDir);
        const ukWav = await ukFuzToWavBytes(item.fuzDest, workDir);
        const englishRef = await prepareReferenceAudio(item.entry, workDir);
        if (dryRun) return;

        const { fuzData } = await buildVoicedFuzFromTtsWav(
          game,
          ukWav,
          workDir,
          item.entry.fileName,
          item.translation,
          englishRef,
        );
        writeIfChanged(item.fuzDest, fuzData, item.fuzDest);
        await upsertVoiceSynthesisState(db, {
          modId,
          formidLower6: item.entry.formidLower6,
          variant: item.entry.variant,
          targetLang: tgtLang,
          ttsTextVersion: item.payloadVersion,
        });
      })(),
      timeoutMs,
      item.entry.fileName,
    );
    return 'rebuilt';
  } catch (err) {
    log.warn(
      `Loudness rebuild ${item.entry.fileName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 'failed';
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

/**
 * Re-apply envelope + English peak match and regenerate LIP/XWM for existing UK `.fuz`
 * files — no TTS calls.
 */
export const rebuildModVoiceLoudness = async (
  db: Tx,
  options: RebuildModVoiceLoudnessOptions,
): Promise<RebuildModVoiceLoudnessResult> => {
  const mod = await loadImportedMod(db, options.modId);
  const tgtLang = options.tgtLang?.trim() || CONFIG.defaultTgtLang;
  const paths = await loadModImportPaths(db, { modId: options.modId });
  const packages = resolveImportPackages(paths.extractDir, tgtLang, paths.pluginPath);
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const concurrency = Math.max(1, options.concurrency ?? REBUILD_VOICE_LOUDNESS_CONCURRENCY);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? REBUILD_VOICE_LOUDNESS_TIMEOUT_MS);

  const items = await collectWork(
    db,
    mod.modId,
    packages,
    mod.srcLang,
    tgtLang,
    force,
    options.limit,
  );

  log.info(
    `Voice loudness rebuild "${mod.modName}" id=${mod.modId}: ${items.length} file(s), concurrency=${concurrency}, timeout=${timeoutMs}ms${dryRun ? ' (dry-run)' : ''}`,
  );

  let rebuilt = 0;
  let skipped = 0;
  let failed = 0;
  const warnings: string[] = [];
  let done = 0;

  await mapWithConcurrency(items, concurrency, async (item) => {
    const result = await rebuildOne(db, mod.modId, mod.game, tgtLang, item, dryRun, timeoutMs);
    done += 1;
    if (result === 'rebuilt') rebuilt += 1;
    else if (result === 'failed') {
      failed += 1;
      warnings.push(item.entry.fileName);
    } else skipped += 1;
    if (done % 25 === 0 || done === items.length) {
      log.info(
        `Voice loudness rebuild progress ${done}/${items.length} (ok=${rebuilt} fail=${failed})`,
      );
    }
  });

  return {
    modId: mod.modId,
    modName: mod.modName,
    rebuilt,
    skipped,
    failed,
    warnings,
  };
};
