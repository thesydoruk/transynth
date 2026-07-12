import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { pluginRelPath, toDiskPath, writeIfChanged, type ImportPackageContext } from '../modImport';
import { synthesizeXttsWav, type XttsSynthesisParams } from '../tts/xttsClient';
import { ensureDir } from '../utils/file';
import type { TtsReferenceMode } from './voiceToolPaths';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from './discoverVoiceFiles';
import {
  loadVoiceSources,
  loadVoiceTranslations,
  lookupVoiceTranslation,
  lookupVoiceSource,
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
import { outputTtsWavRelPath } from './voiceFilePaths';
import { resolveTtsLanguage } from './voiceToolPaths';

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
  srcLang: string,
  tgtLang: string,
  options: {
    xttsBaseUrl: string;
    dryRun: boolean;
    force: boolean;
    referenceMode: TtsReferenceMode;
    synthesis: XttsSynthesisParams;
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

      const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
      if (!row) {
        skipped.push(`${prefix}${entry.relPath} (no translation for variant ${entry.variant})`);
        continue;
      }

      const finishEligibleStep = () => {
        processed += 1;
        options.onEligibleStep?.();
      };

      const ttsWavRel = outputTtsWavRelPath(entry);
      const ttsWavDest = toDiskPath(pkg.localizeDir, ttsWavRel);

      if (options.dryRun) {
        log.info(`[dry-run] ${prefix}${ttsWavRel} ← "${row.translation.slice(0, 80)}..."`);
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

        const ttsWav = await synthesizeXttsWav(row.translation, finalReferenceWav, {
          baseUrl: options.xttsBaseUrl,
          language: resolveTtsLanguage(tgtLang),
          speakerText: referenceText ?? undefined,
          synthesis: options.synthesis,
        });

        const baselinePath = fs.existsSync(ttsWavDest) ? ttsWavDest : null;
        if (!options.force && writeIfChanged(ttsWavDest, ttsWav, baselinePath)) {
          written.push(prefix + ttsWavRel);
        } else if (options.force) {
          ensureDir(path.dirname(ttsWavDest));
          fs.writeFileSync(ttsWavDest, ttsWav);
          written.push(prefix + ttsWavRel);
        } else {
          skipped.push(prefix + ttsWavRel);
        }
        finishEligibleStep();
        log.info(`Voice ${prefix}${ttsWavRel}`);
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
