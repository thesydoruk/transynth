import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { pluginRelPath, toDiskPath, type ImportPackageContext } from '../modImport';
import type { TtsSynthesisParams } from '../tts/ttsSynthesisParams';
import { ttsPipelineConcurrency } from '../tts/ttsRequestPool';
import { mapWithConcurrency } from '../utils/concurrency';
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
  voiceTranslationMapKey,
  type VoiceTranslationRow,
} from './loadVoiceTranslations';
import { migrateVoiceSpeakerRefsFromJsonIfNeeded } from './voiceSpeakerRefs';
import { groupVoiceFilesBySpeaker, voiceSpeakerKey } from './speakerReference';
import {
  prepareVoiceTtsText,
  voiceTtsSkipMessage,
  type PrepareVoiceTtsTextResult,
} from './prepareVoiceTtsText';
import { outputLocalizedFuzRelPath } from './voiceFilePaths';
import { loadVoiceSynthesisVersionMap } from './voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from './voiceTtsPayloadVersion';
import { processVoiceLocalizeEntry, type SpeakerRefCacheEntry } from './processVoiceLocalizeEntry';
import type { ModVoiceGenerateScope } from './localizeModImportVoice';
import type { GameType } from '../types';

type VoiceLocalizeWorkItem = {
  entry: VoiceFileEntry;
  row: VoiceTranslationRow;
  prepared: Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>;
};

/** Synthesize voice lines for one plugin package inside an import extract tree. */
export const localizeVoicePackage = async (
  db: Tx,
  modId: number,
  pkg: ImportPackageContext,
  srcLang: string,
  tgtLang: string,
  options: {
    game: GameType;
    ttsBaseUrl: string;
    dryRun: boolean;
    force: boolean;
    scope: ModVoiceGenerateScope;
    referenceMode: TtsReferenceMode;
    synthesis: TtsSynthesisParams;
    /** When set, only these `FORMID6:variant` keys are synthesized. */
    onlyKeys?: ReadonlySet<string>;
    /** When set, only voice files under this NPC folder are synthesized. */
    speakerKey?: string;
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
  const storedVersions = options.dryRun
    ? new Map<string, string>()
    : await loadVoiceSynthesisVersionMap(db, modId, tgtLang);

  if (voiceFiles.length === 0) {
    log.info(`No voice files under ${prefix}${resolveVoiceRootRel(pluginRel)}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-voice-'));
  let eligibleSeen = 0;

  const voiceRootRel = resolveVoiceRootRel(pluginRel);
  const speakerFilter = options.speakerKey?.trim() || '';
  const speakerRefCache = new Map<string, SpeakerRefCacheEntry>();
  let voiceFilesBySpeaker: Map<string, VoiceFileEntry[]> | undefined;

  const getSiblingEntries = (speaker: string, current: VoiceFileEntry): VoiceFileEntry[] => {
    if (!voiceFilesBySpeaker) {
      voiceFilesBySpeaker = groupVoiceFilesBySpeaker(voiceFiles, voiceRootRel);
    }
    return (voiceFilesBySpeaker.get(speaker) ?? []).filter(
      (candidate) =>
        candidate.formidLower6 !== current.formidLower6 || candidate.variant !== current.variant,
    );
  };

  // Speaker refs may be auto-picked in line mode when a phrase is too short.
  if (!options.dryRun) {
    await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, modId);
  }

  const finishEligibleStep = () => {
    options.onEligibleStep?.();
  };

  const workItems: VoiceLocalizeWorkItem[] = [];

  try {
    for (const entry of voiceFiles) {
      if (options.shouldCancel?.()) break;
      if (options.limit != null && eligibleSeen >= options.limit) break;

      const entryKey = voiceTranslationMapKey(entry.formidLower6, entry.variant);
      if (options.onlyKeys && !options.onlyKeys.has(entryKey)) continue;
      if (speakerFilter && voiceSpeakerKey(entry, voiceRootRel) !== speakerFilter) continue;

      const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
      if (!row) {
        skipped.push(`${prefix}${entry.relPath} (no translation for variant ${entry.variant})`);
        continue;
      }

      const fuzRel = outputLocalizedFuzRelPath(entry);
      const fuzDest = toDiskPath(pkg.localizeDir, fuzRel);

      const prepared = prepareVoiceTtsText({
        lineSource: row.source,
        translation: row.translation,
        speakerSource: row.source,
        edid: row.edid,
      });
      if (prepared.action === 'skip') {
        skipped.push(`${prefix}${entry.relPath} (${voiceTtsSkipMessage(prepared.reason)})`);
        continue;
      }

      const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
      const storedVersion = storedVersions.get(entryKey);

      if (
        !options.force &&
        isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(fuzDest))
      ) {
        continue;
      }

      if (options.dryRun) {
        log.info(`[dry-run] ${prefix}${fuzRel} ← "${prepared.text.slice(0, 80)}..."`);
        eligibleSeen += 1;
        finishEligibleStep();
        continue;
      }

      workItems.push({ entry, row, prepared });
      eligibleSeen += 1;
    }

    if (workItems.length === 0 || options.shouldCancel?.()) return;

    const entryOptions = {
      db,
      modId,
      packageDir: pkg.packageDir,
      pluginRel,
      voiceRootRel,
      localizeDir: pkg.localizeDir,
      prefix,
      tempRoot,
      game: options.game,
      ttsBaseUrl: options.ttsBaseUrl,
      referenceMode: options.referenceMode,
      synthesis: options.synthesis,
      tgtLang,
      force: options.force,
      voiceSources,
      speakerRefCache,
      getSiblingEntries,
      storedVersions,
    };

    const results = await mapWithConcurrency(
      workItems,
      ttsPipelineConcurrency(),
      async ({ entry, row, prepared }) => {
        const result = await processVoiceLocalizeEntry(entry, row, prepared, entryOptions);
        finishEligibleStep();
        return result;
      },
      { shouldAbort: options.shouldCancel },
    );

    for (const result of results) {
      if (result == null) continue;
      if (result.kind === 'written') written.push(result.relPath);
      else if (result.kind === 'skipped') skipped.push(result.relPath);
      else warnings.push(result.message);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
