/**
 * Batch TTS for Disco Final Cut packs (English Audio/*.wav → localized .wav).
 */
import { DISCO_VOICE_MARKUP } from './markup';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { modImportLocalizeDir } from '../../../modStorage';
import type { TtsSynthesisParams } from '../../../tts/ttsClient';
import type { GameId } from '../../../types';
import { ttsPipelineConcurrency } from '../../../tts/ttsRequestPool';
import { runPoolOverAsyncIterable } from '../../../utils/concurrency';
import { ensureDir } from '../../../utils/file';
import { prepareVoiceTtsText } from '../../../voice/prepareVoiceTtsText';
import type { ModVoiceGenerateScope } from '../../../voice/localizeModImportVoice';
import { loadVoiceSynthesisVersionMap } from '../../../voice/voiceSynthesisState';
import type { TtsReferenceMode } from '../../../voice/voiceToolPaths';
import type { SpeakerRefCacheEntry } from '../../../voice/pickVoiceTtsReference';
import { discoVoiceSpeakerKey, groupDiscoVoiceFilesBySpeaker } from './discoverDiscoVoiceFiles';
import { evaluateDiscoVoiceWork, type DiscoVoiceWorkFilter } from './evaluateDiscoVoiceWork';
import { resolveDiscoSpokenRowText } from './resolveDiscoSpokenRow';
import { loadDiscoVoiceSources } from './loadDiscoVoiceSources';
import { loadDiscoVoiceTranslations } from './loadDiscoVoiceTranslations';
import { processDiscoVoiceEntry } from './processDiscoVoiceEntry';
import { resolveDiscoVoiceFilesFromClips } from './resolveClipEntry';
import { outputLocalizedWavRelPath } from './voicePaths';
import { emitVoiceLive } from '../../../voice/voiceLiveEvents';

export type LocalizeDiscoVoiceOptions = {
  extractDir: string;
  modId: number;
  game: GameId;
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
  const filter: DiscoVoiceWorkFilter = {
    onlyKeys,
    speakerFilter,
    tgtLang,
    localizeDir,
    storedVersions,
    forceAll: scope === 'all',
    transcribe: false,
  };
  let total = 0;

  for (const entry of voiceFiles) {
    if (await evaluateDiscoVoiceWork(entry, translations, filter)) total += 1;
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

  const workFilter: DiscoVoiceWorkFilter = {
    onlyKeys,
    speakerFilter,
    tgtLang,
    localizeDir,
    storedVersions,
    forceAll: force,
    transcribe: false,
  };
  log.info(
    `Disco voice: ${voiceFiles.length} wav(s), ${translations.size} translated line(s) (mod ${modId})`,
  );

  // Eligible lines are handed out one at a time, so cancel and the limit stop
  // the job between lines; as many synthesize at once as the TTS pool allows,
  // plus one being prepared (`ttsPipelineConcurrency`).
  async function* workItems(): AsyncGenerator<{
    entry: (typeof voiceFiles)[number];
    row: NonNullable<Awaited<ReturnType<typeof evaluateDiscoVoiceWork>>>['row'];
  }> {
    let processed = 0;
    for (const entry of voiceFiles) {
      if (shouldCancel?.()) return;
      if (limit != null && processed >= limit) return;

      const eligible = await evaluateDiscoVoiceWork(entry, translations, workFilter);
      if (!eligible) continue;

      onEligibleStep?.();
      processed += 1;

      if (dryRun) {
        skipped.push(outputLocalizedWavRelPath(entry));
        continue;
      }
      yield { entry, row: eligible.row };
    }
  }

  const synthesizeOne = async ({
    entry,
    row,
  }: {
    entry: (typeof voiceFiles)[number];
    row: NonNullable<Awaited<ReturnType<typeof evaluateDiscoVoiceWork>>>['row'];
  }): Promise<void> => {
    // Mixed narration+quote: audio-intel decides full vs quoted.
    const spoken = await resolveDiscoSpokenRowText(row, entry.absolutePath);
    const prepared = prepareVoiceTtsText({
      lineSource: spoken.source,
      translation: spoken.translation,
      speakerSource: spoken.source,
      edid: row.edid,
      markup: DISCO_VOICE_MARKUP,
    });
    if (prepared.action !== 'synthesize') {
      warnings.push(`${entry.relPath}: skipped (${prepared.action})`);
      return;
    }

    const live = {
      modId,
      speakerKey: discoVoiceSpeakerKey(entry),
      lineKey: entry.lineKey,
      variant: entry.variant,
    };
    emitVoiceLive({ type: 'line_started', ...live });
    try {
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
              candidate.lineKey !== current.lineKey || candidate.variant !== current.variant,
          ),
        storedVersions,
        signal,
      });
      if (result.kind === 'written') {
        written.push(result.relPath);
        emitVoiceLive({
          type: 'line_done',
          ...live,
          voiceSimilarity: result.voiceSimilarity,
        });
      } else if (result.kind === 'skipped') {
        skipped.push(result.relPath);
        emitVoiceLive({ type: 'line_failed', ...live });
      } else {
        warnings.push(result.message);
        emitVoiceLive({ type: 'line_failed', ...live });
      }
    } catch (err) {
      emitVoiceLive({ type: 'line_failed', ...live });
      throw err;
    }
  };

  try {
    await runPoolOverAsyncIterable(workItems(), ttsPipelineConcurrency(), synthesizeOne, {
      shouldAbort: () => shouldCancel?.() ?? false,
    });
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
};
