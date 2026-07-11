import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { pluginRelPath, toDiskPath, writeIfChanged, type ImportPackageContext } from '../modImport';
import type { GameType } from '../types';
import { ensureDir } from '../utils/file';
import { resolveTtsLanguage, type TtsReferenceMode } from './voiceToolPaths';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from './discoverVoiceFiles';
import {
  loadVoiceSources,
  loadVoiceTranslations,
  lookupVoiceSource,
  voiceTranslationMapKey,
  type VoiceSourceRow,
} from './loadVoiceTranslations';
import { migrateVoiceSpeakerRefsFromJsonIfNeeded } from './voiceSpeakerRefs';
import {
  groupVoiceFilesBySpeaker,
  resolveSpeakerReferenceForSpeaker,
  voiceSpeakerKey,
  type ResolvedSpeakerReference,
} from './speakerReferencePool';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { synthesizeVoicedLine } from './synthesizeVoicedLine';
import { outputFuzRelPath, outputRefWavRelPath, outputTtsWavRelPath } from './voiceFilePaths';

type SpeakerRefCacheEntry = {
  wavPath: string;
  referenceText: string | null;
};

const referenceTextForPick = (
  sources: Map<string, VoiceSourceRow>,
  pick: ResolvedSpeakerReference['pick'],
): string | null => {
  if (pick.formidLower6.toUpperCase() === 'MANUAL') return null;
  return lookupVoiceSource(sources, pick.formidLower6, pick.variant);
};

/** Synthesize voice lines for one plugin package inside an import extract tree. */
export const localizeVoicePackage = async (
  db: Tx,
  modId: number,
  pkg: ImportPackageContext,
  game: GameType,
  srcLang: string,
  tgtLang: string,
  options: {
    xttsBaseUrl: string;
    dryRun: boolean;
    force: boolean;
    referenceMode: TtsReferenceMode;
    limit?: number;
    shouldCancel?: () => boolean;
    onEligibleStep?: () => void;
  },
  written: string[],
  skipped: string[],
  warnings: string[],
): Promise<void> => {
  const prefix = pkg.folder ? `${pkg.folder}/` : '';
  const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
  const translations = await loadVoiceTranslations(db, modId, srcLang, tgtLang);
  const voiceSources = await loadVoiceSources(db, modId, srcLang);
  const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel));

  if (voiceFiles.length === 0) {
    log.info(`No voice files under ${prefix}${resolveVoiceRootRel(pluginRel)}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-voice-'));
  let processed = 0;

  const voiceRootRel = resolveVoiceRootRel(pluginRel);
  const speakerRefCache = new Map<string, SpeakerRefCacheEntry>();
  let voiceFilesBySpeaker: Map<string, VoiceFileEntry[]> | undefined;

  const getSiblingEntries = (speakerKey: string, current: VoiceFileEntry): VoiceFileEntry[] => {
    if (!voiceFilesBySpeaker) {
      voiceFilesBySpeaker = groupVoiceFilesBySpeaker(voiceFiles, voiceRootRel);
    }
    return (voiceFilesBySpeaker.get(speakerKey) ?? []).filter(
      (candidate) =>
        candidate.formidLower6 !== current.formidLower6 || candidate.variant !== current.variant,
    );
  };

  if (options.referenceMode === 'speaker' && !options.dryRun) {
    await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, modId);
  }

  try {
    for (const entry of voiceFiles) {
      if (options.shouldCancel?.()) break;
      if (options.limit != null && processed >= options.limit) break;

      const row = translations.get(voiceTranslationMapKey(entry.formidLower6, entry.variant));
      if (!row) {
        skipped.push(`${prefix}${entry.relPath} (no translation for variant ${entry.variant})`);
        continue;
      }

      const finishEligibleStep = () => {
        processed += 1;
        options.onEligibleStep?.();
      };

      const outRel = outputFuzRelPath(entry);
      const ttsWavRel = outputTtsWavRelPath(entry);
      const refWavRel = outputRefWavRelPath(entry);
      const destPath = toDiskPath(pkg.localizeDir, outRel);
      const ttsWavDest = toDiskPath(pkg.localizeDir, ttsWavRel);
      const refWavDest = toDiskPath(pkg.localizeDir, refWavRel);
      const baselinePath = toDiskPath(pkg.packageDir, outRel);

      if (options.dryRun) {
        log.info(`[dry-run] ${prefix}${outRel} ← "${row.translation.slice(0, 80)}..."`);
        finishEligibleStep();
        continue;
      }

      try {
        const workDir = path.join(tempRoot, `${entry.formidLower6}_${entry.variant}`);
        ensureDir(workDir);

        const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
        let referenceWav: string | undefined;
        let referenceText: string | null =
          options.referenceMode === 'line'
            ? row.source
            : lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant);
        if (options.referenceMode === 'speaker' && speakerKey) {
          const cached = speakerRefCache.get(speakerKey);
          if (cached) {
            referenceWav = cached.wavPath;
            referenceText = cached.referenceText;
          } else {
            const resolved = await resolveSpeakerReferenceForSpeaker(
              db,
              modId,
              speakerKey,
              entry,
              () => getSiblingEntries(speakerKey, entry),
              pkg.packageDir,
              pluginRel,
            );
            if (resolved) {
              referenceWav = resolved.wavPath;
              referenceText = referenceTextForPick(voiceSources, resolved.pick);
              speakerRefCache.set(speakerKey, {
                wavPath: resolved.wavPath,
                referenceText,
              });
            }
          }
        }

        const finalReferenceWav =
          options.referenceMode === 'line'
            ? await prepareReferenceAudio(entry, workDir)
            : (referenceWav ?? (await prepareReferenceAudio(entry, workDir)));
        if (!referenceText) {
          referenceText = lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant);
        }
        const { fuz: fuzData, ttsWav } = await synthesizeVoicedLine(
          game,
          entry,
          row.translation,
          finalReferenceWav,
          referenceText,
          workDir,
          options.xttsBaseUrl,
          resolveTtsLanguage(),
        );

        // TODO: remove — keep TTS + reference WAV next to .fuz for A/B listening.
        ensureDir(path.dirname(ttsWavDest));
        fs.writeFileSync(ttsWavDest, ttsWav);
        fs.copyFileSync(finalReferenceWav, refWavDest);
        written.push(prefix + ttsWavRel);
        written.push(prefix + refWavRel);

        if (
          !options.force &&
          writeIfChanged(destPath, fuzData, fs.existsSync(baselinePath) ? baselinePath : null)
        ) {
          written.push(prefix + outRel);
        } else if (options.force) {
          ensureDir(path.dirname(destPath));
          fs.writeFileSync(destPath, fuzData);
          written.push(prefix + outRel);
        } else {
          skipped.push(prefix + outRel);
        }
        finishEligibleStep();
        log.info(`Voice ${prefix}${outRel}`);
      } catch (err) {
        warnings.push(
          `${prefix}${entry.relPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        finishEligibleStep();
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
