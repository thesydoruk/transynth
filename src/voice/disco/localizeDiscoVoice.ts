/**
 * Batch TTS for Disco Final Cut packs (English Audio/*.wav → localized .wav).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { toDiskPath } from '../../modImport';
import { modImportLocalizeDir } from '../../modStorage';
import type { TtsSynthesisParams } from '../../tts/ttsClient';
import type { GameType } from '../../types';
import { ensureDir } from '../../utils/file';
import { canSynthesizeVoiceLine, prepareVoiceTtsText } from '../prepareVoiceTtsText';
import { lookupVoiceTranslation, voiceTranslationMapKey } from '../loadVoiceTranslations';
import type { ModVoiceGenerateScope } from '../localizeModImportVoice';
import { loadVoiceSynthesisVersionMap, lookupVoiceSynthesisVersion } from '../voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from '../voiceTtsPayloadVersion';
import type { TtsReferenceMode } from '../voiceToolPaths';
import type { SpeakerRefCacheEntry } from '../pickVoiceTtsReference';
import {
  discoSpeakerKeyFromStem,
  discoVoiceSpeakerKey,
  groupDiscoVoiceFilesBySpeaker,
} from './discoverDiscoVoiceFiles';
import { resolveDiscoSpokenRowText } from './discoSpokenText';
import { loadDiscoVoiceSources } from './loadDiscoVoiceSources';
import { loadDiscoVoiceTranslations } from './loadDiscoVoiceTranslations';
import { processDiscoVoiceEntry } from './processDiscoVoiceEntry';
import { resolveDiscoVoiceFilesFromClips } from './resolveClipEntry';
import { outputLocalizedWavRelPath } from './voicePaths';

export type LocalizeDiscoVoiceOptions = {
  extractDir: string;
  modId: number;
  game: GameType;
  srcLang: string;
  tgtLang: string;
  ttsBaseUrl: string;
  synthesis: TtsSynthesisParams;
  referenceMode: TtsReferenceMode;
  force: boolean;
  scope: ModVoiceGenerateScope;
  onlyKeys?: ReadonlySet<string>;
  speakerKey?: string;
  limit?: number;
  dryRun?: boolean;
  onEligibleStep?: () => void;
  shouldCancel?: () => boolean;
  signal?: AbortSignal;
};

export const countDiscoVoiceLocalizeWork = async (
  db: Tx,
  modId: number,
  extractDir: string,
  srcLang: string,
  tgtLang: string,
  scope: ModVoiceGenerateScope = 'missing',
  onlyKeys?: ReadonlySet<string>,
  speakerKey?: string,
): Promise<number> => {
  const storedVersions = await loadVoiceSynthesisVersionMap(db, modId, tgtLang);
  const speakerFilter = speakerKey?.trim() || '';
  const translations = await loadDiscoVoiceTranslations(
    db,
    modId,
    srcLang,
    tgtLang,
    extractDir,
    speakerFilter ? { speakerKey: speakerFilter } : {},
  );
  const voiceFiles = await resolveDiscoVoiceFilesFromClips(
    db,
    modId,
    extractDir,
    speakerFilter || undefined,
  );
  const localizeDir = modImportLocalizeDir(extractDir, tgtLang);
  const forceAll = scope === 'all';
  let total = 0;

  for (const entry of voiceFiles) {
    const stem = path.basename(entry.fileName, path.extname(entry.fileName));
    if (onlyKeys && !onlyKeys.has(voiceTranslationMapKey(entry.formidLower6, entry.variant))) {
      continue;
    }
    if (speakerFilter && discoSpeakerKeyFromStem(stem) !== speakerFilter) continue;
    const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
    if (!row || !canSynthesizeVoiceLine(row.source, row.translation, row.edid, 'disco')) continue;
    // Mixed narration+quote lines: synthesize only what the clip voices.
    const spoken = resolveDiscoSpokenRowText(row, entry.absolutePath);
    const prepared = prepareVoiceTtsText({
      lineSource: spoken.source,
      translation: spoken.translation,
      speakerSource: spoken.source,
      edid: row.edid,
      markup: 'disco',
    });
    if (prepared.action !== 'synthesize') continue;
    if (!forceAll) {
      const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
      const wavDest = toDiskPath(localizeDir, outputLocalizedWavRelPath(entry));
      const storedVersion = lookupVoiceSynthesisVersion(
        storedVersions,
        discoVoiceSpeakerKey(entry),
        entry.formidLower6,
        entry.variant,
      );
      if (isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(wavDest))) {
        continue;
      }
    }
    total += 1;
  }
  return total;
};

export const localizeDiscoVoicePackage = async (
  db: Tx,
  options: LocalizeDiscoVoiceOptions,
  written: string[],
  skipped: string[],
  warnings: string[],
): Promise<void> => {
  const {
    extractDir,
    modId,
    game,
    srcLang,
    tgtLang,
    ttsBaseUrl,
    synthesis,
    referenceMode,
    force,
    onlyKeys,
    speakerKey,
    limit,
    dryRun,
    onEligibleStep,
    shouldCancel,
    signal,
  } = options;

  const localizeDir = modImportLocalizeDir(extractDir, tgtLang);
  ensureDir(localizeDir);
  const speakerFilter = speakerKey?.trim() || '';
  const loadFilter = speakerFilter ? { speakerKey: speakerFilter } : {};
  const translations = await loadDiscoVoiceTranslations(
    db,
    modId,
    srcLang,
    tgtLang,
    extractDir,
    loadFilter,
  );
  const voiceSources = await loadDiscoVoiceSources(db, modId, srcLang, extractDir, loadFilter);
  const voiceFiles = await resolveDiscoVoiceFilesFromClips(
    db,
    modId,
    extractDir,
    speakerFilter || undefined,
  );
  const bySpeaker = groupDiscoVoiceFilesBySpeaker(voiceFiles);
  const speakerRefCache = new Map<string, SpeakerRefCacheEntry>();
  const storedVersions = await loadVoiceSynthesisVersionMap(db, modId, tgtLang);
  const tempRoot = path.join(os.tmpdir(), `disco-voice-${modId}-${Date.now()}`);
  ensureDir(tempRoot);

  let processed = 0;
  log.info(
    `Disco voice: ${voiceFiles.length} wav(s), ${translations.size} translated line(s) (mod ${modId})`,
  );

  try {
    for (const entry of voiceFiles) {
      if (shouldCancel?.()) break;
      if (limit != null && processed >= limit) break;

      const stem = path.basename(entry.fileName, path.extname(entry.fileName));
      if (onlyKeys && !onlyKeys.has(voiceTranslationMapKey(entry.formidLower6, entry.variant))) {
        continue;
      }
      if (speakerFilter && discoSpeakerKeyFromStem(stem) !== speakerFilter) continue;

      const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
      if (!row || !canSynthesizeVoiceLine(row.source, row.translation, row.edid, 'disco')) continue;

      // Mixed narration+quote lines: synthesize only what the clip voices.
      const spoken = resolveDiscoSpokenRowText(row, entry.absolutePath);
      const prepared = prepareVoiceTtsText({
        lineSource: spoken.source,
        translation: spoken.translation,
        speakerSource: spoken.source,
        edid: row.edid,
        markup: 'disco',
      });
      if (prepared.action !== 'synthesize') {
        warnings.push(`${entry.relPath}: skipped (${prepared.action})`);
        continue;
      }

      onEligibleStep?.();
      processed += 1;

      if (dryRun) {
        skipped.push(outputLocalizedWavRelPath(entry));
        continue;
      }

      const result = await processDiscoVoiceEntry(entry, row, prepared, {
        db,
        modId,
        extractDir,
        localizeDir,
        tempRoot,
        game,
        ttsBaseUrl,
        referenceMode,
        synthesis,
        tgtLang,
        force,
        voiceSources,
        speakerRefCache,
        getSiblingEntries: (key, current) =>
          (bySpeaker.get(key) ?? []).filter(
            (candidate) =>
              candidate.formidLower6 !== current.formidLower6 ||
              candidate.variant !== current.variant,
          ),
        storedVersions,
        signal,
      });
      if (result.kind === 'written') written.push(result.relPath);
      else if (result.kind === 'skipped') skipped.push(result.relPath);
      else warnings.push(result.message);
    }
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
};
