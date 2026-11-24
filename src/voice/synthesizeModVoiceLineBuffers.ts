import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import type { GameId } from '../types';
import { pluginRelPath } from '../modImport';
import { loadImportedMod } from '../modImport/importedMod';
import { ensureDir } from '../utils/file';
import { isDependencyUnavailableError } from '../pipeline/errors';
import { getJobRuntime } from '../pipeline/jobRuntime';
import { ensureDependencyHealthy } from '../pipeline/waitForHealthy';
import { checkTtsHealth, synthesizeWav, type TtsSynthesisParams } from '../tts/ttsClient';
import { resolveVoiceRootRel } from './discoverVoiceFiles';
import {
  loadVoiceSources,
  loadVoiceTranslations,
  lookupVoiceTranslation,
} from './loadVoiceTranslations';
import { migrateVoiceSpeakerRefsFromJsonIfNeeded } from './voiceSpeakerRefs';
import { groupVoiceFilesBySpeaker, voiceSpeakerKey } from './speakerReference';
import { pickVoiceTtsReference } from './pickVoiceTtsReference';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import {
  prepareVoiceTtsText,
  stripVoiceNonSpeechBlocks,
  voiceTtsSkipMessage,
} from './prepareVoiceTtsText';
import { voiceTakeSource, type VoiceTakeSource } from './referenceVoiceTakeHooks';
import { FUZ_TAKES, type BuiltVoiceTake, type VoiceTakeFormat } from './takeFormat';
import { loadTakeSpeakerSexResolver } from './takeSpeakerSex';
import { voiceTtsPayloadVersionFromPrepared } from './voiceTtsPayloadVersion';
import { resolveTtsBaseUrl, resolveTtsLanguage, type TtsReferenceMode } from './voiceToolPaths';
import { loadVoiceProjectSettings } from './voiceProjectSettings';
import { fillMissingVoiceKeys } from './voiceTextRows';
import { findMasterBackedTake, type MasterBackedTake } from './voiceWorkList';
import { findVoiceEntry } from '../web/voice/preview/voiceEntries';

export type SynthesizeModVoiceLineOptions = {
  modId: number;
  packageDir: string;
  pluginPath: string;
  lineKey: string;
  variant: number;
  srcLang: string;
  tgtLang: string;
  /** Voice folder to dub; required to pick a side when several share the line. */
  speakerKey?: string;
  /** Plugin that owns the line; required when two origins share the lower-6 FormID. */
  originPlugin?: string | null;
  game?: GameId;
  /** How the game stores takes; `.fuz` when omitted. */
  takes?: VoiceTakeFormat;
  referenceMode?: TtsReferenceMode;
  ttsBaseUrl?: string;
  synthesis?: Partial<TtsSynthesisParams>;
  /** Return true to abort before the TTS call when the stored stamp is already current. */
  skipIfCurrent?: (payloadVersion: string, takeRel: string) => Promise<boolean> | boolean;
};

export type SynthesizeModVoiceLineBuffersResult =
  | {
      ok: true;
      /** The WAV the take was encoded from, for the browser. */
      ttsWav: Buffer;
      /** The take and the files that go beside it. */
      take: Pick<BuiltVoiceTake, 'data' | 'sidecars'>;
      /** Where the take goes, relative to the localize directory. */
      takeRel: string;
      payloadVersion: string;
      voiceSimilarity: number | null;
      /** The original take the line was cloned from, and the text spoken over it. */
      reference: VoiceTakeSource;
    }
  | { ok: false; reason: string; message: string };

/** Synthesize one voiced line and return the preview WAV plus the packed take without writing to disk. */
export const synthesizeModVoiceLineBuffers = async (
  db: Tx,
  opts: SynthesizeModVoiceLineOptions,
): Promise<SynthesizeModVoiceLineBuffersResult> => {
  const takes = opts.takes ?? FUZ_TAKES;
  const pluginRel = pluginRelPath(opts.packageDir, opts.pluginPath);
  const voiceRootRel = resolveVoiceRootRel(pluginRel);
  const voiceFiles = takes.discover(opts.packageDir, pluginRel);
  let entry = findVoiceEntry(voiceFiles, opts.lineKey, opts.variant, {
    voiceRootRel,
    speakerKey: opts.speakerKey,
    originPlugin: opts.originPlugin,
  });
  // A line this mod overrides but did not record: dub against the master's take.
  let masterBacked: MasterBackedTake | null = null;
  if (!entry && opts.originPlugin) {
    masterBacked = await findMasterBackedTake(db, {
      modId: opts.modId,
      pluginPath: opts.pluginPath,
      originPlugin: opts.originPlugin,
      lineKey: opts.lineKey,
      variant: opts.variant,
      speakerKey: opts.speakerKey,
      srcLang: opts.srcLang,
      tgtLang: opts.tgtLang,
      takes,
    });
    entry = masterBacked?.entry;
  }
  if (!entry) {
    return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }

  const translations = await loadVoiceTranslations(db, opts.modId, opts.srcLang, opts.tgtLang);
  const row = lookupVoiceTranslation(
    translations,
    entry.lineKey,
    entry.variant,
    entry.originPlugin,
  );
  if (!row?.translation?.trim()) {
    return { ok: false, reason: 'no_translation', message: 'No translation for this voice line' };
  }
  const referenceSource = masterBacked?.referenceSource ?? row.source;

  // The version stamp must hash the line-source transcript, exactly like the
  // batch path (processVoiceLocalizeEntry) — otherwise takes committed here are
  // seen as stale by mod-wide jobs and get re-synthesized/overwritten.
  const prepared = prepareVoiceTtsText({
    lineSource: row.source,
    translation: row.translation,
    speakerSource: referenceSource,
    edid: row.edid,
  });
  if (prepared.action === 'skip') {
    return {
      ok: false,
      reason: 'non_speech',
      message: voiceTtsSkipMessage(prepared.reason),
    };
  }

  const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, opts.tgtLang);
  const takeRel = takes.localizedRelPath(entry);
  if (await opts.skipIfCurrent?.(payloadVersion, takeRel)) {
    return { ok: false, reason: 'up_to_date', message: 'Voice line audio is already up to date' };
  }

  const ttsBaseUrl = opts.ttsBaseUrl ?? resolveTtsBaseUrl();
  const mod = await loadImportedMod(db, opts.modId);
  const game = opts.game ?? mod.game;
  const voiceConfig = await loadVoiceProjectSettings(db, game);
  const referenceMode = opts.referenceMode ?? voiceConfig.referenceMode;
  const synthesis = { ...voiceConfig.synthesis, ...opts.synthesis };

  // Line mode may auto-pick a speaker ref when the line clip is too short or too long.
  await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, opts.modId);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-voice-line-'));

  try {
    if (getJobRuntime()) await ensureDependencyHealthy('tts');
    else await checkTtsHealth(ttsBaseUrl);

    const workDir = path.join(tempRoot, `${entry.lineKey}_${entry.variant}`);
    ensureDir(workDir);

    const voiceSources = await loadVoiceSources(db, opts.modId, opts.srcLang);
    if (masterBacked) {
      fillMissingVoiceKeys(
        voiceSources,
        await loadVoiceSources(db, masterBacked.context.master.modId, opts.srcLang),
      );
    }
    const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
    const lineEnglishWav = await prepareReferenceAudio(entry, workDir);
    const siblingPool = masterBacked
      ? masterBacked.context.bySpeaker
      : groupVoiceFilesBySpeaker(voiceFiles, voiceRootRel);
    const siblings = speakerKey
      ? (siblingPool
          .get(speakerKey)
          ?.filter(
            (candidate) =>
              candidate.lineKey !== entry.lineKey ||
              candidate.variant !== entry.variant ||
              candidate.originPlugin !== entry.originPlugin,
          ) ?? [])
      : [];
    const picked = await pickVoiceTtsReference({
      db,
      modId: opts.modId,
      packageDir: opts.packageDir,
      pluginRelPath: pluginRel,
      speakerKey: speakerKey || null,
      entry,
      lineEnglishWav,
      lineSource: referenceSource,
      referenceMode,
      voiceSources,
      getSiblingEntries: () => siblings,
    });

    // TTS may speak against a different reference transcript than the line
    // source; the version stamp above stays on the line-source transcript.
    const tts = await synthesizeWav(
      prepared.text,
      picked.clips.map((clip) => ({
        wavPath: clip.wavPath,
        speakerText: stripVoiceNonSpeechBlocks(clip.speakerText ?? referenceSource) || undefined,
      })),
      {
        baseUrl: ttsBaseUrl,
        language: resolveTtsLanguage(opts.tgtLang),
        synthesis: picked.matchTiming === false ? { ...synthesis, matchTiming: false } : synthesis,
      },
    );

    const speakerSexOf = await loadTakeSpeakerSexResolver(db, opts.modId, takes);
    const built = await takes.build({
      game,
      ttsWav: tts.wav,
      workDir,
      fileName: entry.fileName,
      text: prepared.text,
      sourceTakePath: entry.absolutePath,
      actor: speakerSexOf?.(speakerKey),
      includePreviewWav: true,
    });

    if (!built.previewWav) {
      return { ok: false, reason: 'tts_failed', message: 'TTS preview WAV was not built' };
    }

    return {
      ok: true,
      ttsWav: built.previewWav,
      take: { data: built.data, sidecars: built.sidecars },
      takeRel,
      payloadVersion,
      voiceSimilarity: tts.voiceSimilarity,
      reference: voiceTakeSource(entry, row),
    };
  } catch (err) {
    if (isDependencyUnavailableError(err)) throw err;
    return {
      ok: false,
      reason: 'tts_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
