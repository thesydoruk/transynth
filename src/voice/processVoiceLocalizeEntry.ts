import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { toDiskPath } from '../modImport';
import { isDependencyUnavailableError } from '../pipeline/errors';
import { synthesizeWav, type TtsSynthesisParams } from '../tts/ttsClient';
import { ensureDir } from '../utils/file';
import type { VoiceFileEntry } from './discoverVoiceFiles';
import type { VoiceSourceRow, VoiceTranslationRow } from './loadVoiceTranslations';
import { voiceSpeakerKey } from './speakerReference';
import { lookupVoiceSynthesisVersion, voiceSynthesisStateKey } from './voiceSynthesisState';
import { pickVoiceTtsReference, type SpeakerRefCacheEntry } from './pickVoiceTtsReference';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { stripVoiceNonSpeechBlocks, type PrepareVoiceTtsTextResult } from './prepareVoiceTtsText';
import { FUZ_TAKES, type VoiceTakeFormat } from './takeFormat';
import { takeOnDisk, writeVoiceTake, writeVoiceTakeIfChanged } from './takeSidecars';
import type { TakeSpeakerSexResolver } from './takeSpeakerSex';
import { recordVoiceTake, voiceTakeSource } from './referenceVoiceTakeHooks';
import { voiceTtsPayloadVersionFromPrepared, voiceTtsRequestText } from './voiceTtsPayloadVersion';
import {
  lookupVoiceResynthStamp,
  settleVoiceResynthTake,
  voiceLineSynthesisParams,
  voiceTakeNeedsWork,
  type VoiceResynthContext,
} from './voiceResynth';
import { resolveTtsLanguage, type TtsReferenceMode } from './voiceToolPaths';
import type { GameId } from '../types';

export type { SpeakerRefCacheEntry } from './pickVoiceTtsReference';

export type ProcessVoiceLocalizeEntryOptions = {
  db: Tx;
  modId: number;
  packageDir: string;
  pluginRel: string;
  voiceRootRel: string;
  localizeDir: string;
  prefix: string;
  tempRoot: string;
  game: GameId;
  /** How the game stores takes; `.fuz` when omitted. */
  takes?: VoiceTakeFormat;
  /** Sex of a voice folder's speaker, for a take format that needs it. */
  speakerSexOf?: TakeSpeakerSexResolver;
  ttsBaseUrl: string;
  referenceMode: TtsReferenceMode;
  synthesis: TtsSynthesisParams;
  tgtLang: string;
  force: boolean;
  /** Set for a `low-similarity` job: its picks, retry policy and replacement rule. */
  resynth?: VoiceResynthContext;
  voiceSources: Map<string, VoiceSourceRow>;
  speakerRefCache: Map<string, SpeakerRefCacheEntry>;
  getSiblingEntries: (speakerKey: string, current: VoiceFileEntry) => VoiceFileEntry[];
  storedVersions: Map<string, string>;
  signal?: AbortSignal;
  /**
   * Transcript of the take used as reference audio when it is not the line's
   * own source — a patch dubbing a master's line against the master's take.
   */
  referenceSource?: string | null;
};

export type ProcessVoiceLocalizeEntryResult =
  | { kind: 'written'; relPath: string; voiceSimilarity: number | null }
  /** A re-synthesis that did not beat the stored take; `voiceSimilarity` is the stored score. */
  | { kind: 'kept'; relPath: string; reason: string; voiceSimilarity: number | null }
  | { kind: 'skipped'; relPath: string }
  | { kind: 'warning'; message: string };

/** Synthesize one voice file entry into a localized take under the mod tree. */
export const processVoiceLocalizeEntry = async (
  entry: VoiceFileEntry,
  row: VoiceTranslationRow,
  prepared: Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>,
  options: ProcessVoiceLocalizeEntryOptions,
): Promise<ProcessVoiceLocalizeEntryResult> => {
  const {
    db,
    modId,
    packageDir,
    pluginRel,
    voiceRootRel,
    localizeDir,
    prefix,
    tempRoot,
    game,
    ttsBaseUrl,
    referenceMode,
    synthesis,
    tgtLang,
    force,
    resynth,
    voiceSources,
    speakerRefCache,
    getSiblingEntries,
    storedVersions,
    signal,
  } = options;
  const referenceSource = options.referenceSource ?? row.source;
  const takes = options.takes ?? FUZ_TAKES;

  const takeRel = takes.localizedRelPath(entry);
  const takeDest = toDiskPath(localizeDir, takeRel);
  let workDir: string | undefined;

  try {
    const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
    const originPlugin = entry.originPlugin;
    const versionKey = voiceSynthesisStateKey(
      speakerKey,
      entry.lineKey,
      entry.variant,
      originPlugin,
    );
    const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
    const due = voiceTakeNeedsWork({
      force,
      resynth,
      speakerKey,
      lineKey: entry.lineKey,
      variant: entry.variant,
      origin: originPlugin,
      storedVersion: lookupVoiceSynthesisVersion(
        storedVersions,
        speakerKey,
        entry.lineKey,
        entry.variant,
        originPlugin,
      ),
      payloadVersion,
      fileExists: takeOnDisk(takeDest, takes.sidecarExtensions),
    });
    if (!due) return { kind: 'skipped', relPath: prefix + takeRel };

    workDir = path.join(
      tempRoot,
      `${originPlugin ?? ''}_${speakerKey}_${entry.lineKey}_${entry.variant}`,
    );
    ensureDir(workDir);
    const lineEnglishWav = await prepareReferenceAudio(entry, workDir);
    const picked = await pickVoiceTtsReference({
      db,
      modId,
      packageDir,
      pluginRelPath: pluginRel,
      speakerKey: speakerKey || null,
      entry,
      lineEnglishWav,
      lineSource: referenceSource,
      referenceMode,
      voiceSources,
      getSiblingEntries: (key) => getSiblingEntries(key, entry),
      speakerRefCache,
      signal,
    });

    // TTS may use a different reference transcript than the line source; version
    // stamp stays on prepared text so it matches count/availability/rebuild.
    const tts = await synthesizeWav(
      voiceTtsRequestText(prepared),
      picked.clips.map((clip) => ({
        wavPath: clip.wavPath,
        speakerText: stripVoiceNonSpeechBlocks(clip.speakerText ?? referenceSource) || undefined,
      })),
      {
        baseUrl: ttsBaseUrl,
        language: resolveTtsLanguage(tgtLang),
        synthesis: {
          ...(await voiceLineSynthesisParams(db, synthesis, resynth)),
          ...(picked.matchTiming === false ? { matchTiming: false } : {}),
        },
        signal,
      },
    );

    const built = await takes.build({
      game,
      ttsWav: tts.wav,
      workDir,
      fileName: entry.fileName,
      text: prepared.text,
      sourceTakePath: entry.absolutePath,
      actor: options.speakerSexOf?.(speakerKey),
    });

    const reference = { ...voiceTakeSource(entry, row), takePath: takeDest };
    /** Stamp the take just written and keep a copy in the reference voice store. */
    const recordTake = async (): Promise<void> => {
      await recordVoiceTake(db, reference, {
        modId,
        lineKey: entry.lineKey,
        variant: entry.variant,
        speakerKey,
        originPlugin,
        targetLang: tgtLang,
        ttsTextVersion: payloadVersion,
        voiceSimilarity: tts.voiceSimilarity,
      });
      storedVersions.set(versionKey, payloadVersion);
    };

    if (resynth) {
      const take = {
        modId,
        lineKey: entry.lineKey,
        variant: entry.variant,
        targetLang: tgtLang,
        speakerKey,
        originPlugin,
      };
      const settled = await settleVoiceResynthTake(
        db,
        resynth,
        take,
        { payloadVersion, newSimilarity: tts.voiceSimilarity },
        () => writeVoiceTake(takeDest, built),
        reference,
      );
      if (settled.kind === 'kept') {
        log.info(`Voice ${prefix}${takeRel} kept (${settled.reason})`);
        return {
          kind: 'kept',
          relPath: prefix + takeRel,
          reason: settled.reason,
          voiceSimilarity:
            lookupVoiceResynthStamp(resynth, speakerKey, entry.lineKey, entry.variant, originPlugin)
              ?.voiceSimilarity ?? null,
        };
      }
      storedVersions.set(versionKey, payloadVersion);
      log.info(`Voice ${prefix}${takeRel}`);
      return { kind: 'written', relPath: prefix + takeRel, voiceSimilarity: tts.voiceSimilarity };
    }

    const baselinePath = fs.existsSync(takeDest) ? takeDest : null;
    if (!force && writeVoiceTakeIfChanged(takeDest, built, baselinePath)) {
      await recordTake();
      log.info(`Voice ${prefix}${takeRel}`);
      return { kind: 'written', relPath: prefix + takeRel, voiceSimilarity: tts.voiceSimilarity };
    }
    if (force) {
      writeVoiceTake(takeDest, built);
      await recordTake();
      log.info(`Voice ${prefix}${takeRel}`);
      return { kind: 'written', relPath: prefix + takeRel, voiceSimilarity: tts.voiceSimilarity };
    }
    return { kind: 'skipped', relPath: prefix + takeRel };
  } catch (err) {
    if (signal?.aborted) return { kind: 'skipped', relPath: prefix + takeRel };
    if (isDependencyUnavailableError(err)) throw err;
    const message = `${prefix}${entry.relPath}: ${err instanceof Error ? err.message : String(err)}`;
    log.warn(`Voice synthesis failed ${message}`);
    return { kind: 'warning', message };
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
};
