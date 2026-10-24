/**
 * Synthesize one Witcher 3 line: clone the voice from its own original take,
 * speak the translation, and package the result as the game stores it.
 *
 * The reference is the line's own take: it is its speaker by definition, in
 * the mood of that very line. TTS is asked to match its timing, so the scene's
 * pacing survives.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { isDependencyUnavailableError } from '../../../pipeline/errors';
import { synthesizeWav, type TtsSynthesisParams } from '../../../tts/ttsClient';
import { ensureDir } from '../../../utils/file';
import {
  prepareVoiceTtsText,
  stripVoiceNonSpeechBlocks,
  type PrepareVoiceTtsTextResult,
} from '../../../voice/prepareVoiceTtsText';
import {
  lookupVoiceSynthesisVersion,
  upsertVoiceSynthesisState,
  voiceSynthesisStateKey,
} from '../../../voice/voiceSynthesisState';
import { voiceTtsPayloadVersionFromPrepared } from '../../../voice/voiceTtsPayloadVersion';
import { pickVoiceTtsReference } from '../../../voice/pickVoiceTtsReference';
import {
  lookupVoiceResynthStamp,
  settleVoiceResynthTake,
  voiceLineSynthesisParams,
  voiceTakeNeedsWork,
  type VoiceResynthContext,
} from '../../../voice/voiceResynth';
import { resolveTtsLanguage } from '../../../voice/voiceToolPaths';
import { decodeOpusWemToWav } from '../audio/opusWem';
import type { MimicModel } from '../mimic/model';
import { parseW3SpeechAudio } from '../w3speech';
import { buildW3Take } from './buildTake';
import type { W3VoiceLine } from './lines';
import { WITCHER3_VOICE_MARKUP } from './markup';
import { W3_UNKNOWN_SPEAKER } from './clips';
import type { W3ReferenceContext } from './references';
import { W3_VOICE_VARIANT, w3LocalizedTakePaths, w3SourceTakeEntry } from './takes';

/** The rate every other game's reference clips are decoded to. */
const REFERENCE_SAMPLE_RATE = 22050;

export type W3LineSynthesisContext = {
  db: Tx;
  modId: number;
  localizeDir: string;
  tempRoot: string;
  ttsBaseUrl: string;
  synthesis: TtsSynthesisParams;
  tgtLang: string;
  model: MimicModel | null;
  /** Where `model` was loaded from, so it can run on worker threads. */
  modelPath: string | null;
  /** Speaker-aware references (see `references.ts`); without it, a line clones from its own take. */
  reference: W3ReferenceContext | null;
  force: boolean;
  /** Set for a `low-similarity` job: its picks, retry policy and replacement rule. */
  resynth?: VoiceResynthContext;
  storedVersions: Map<string, string>;
  signal?: AbortSignal;
};

export type W3LineSynthesisResult =
  | { kind: 'written'; relPath: string; voiceSimilarity: number | null; lipSource: string }
  /** A re-synthesis that did not beat the stored take; `voiceSimilarity` is the stored score. */
  | { kind: 'kept'; relPath: string; reason: string; voiceSimilarity: number | null }
  | { kind: 'skipped'; relPath: string; reason: string }
  | { kind: 'warning'; message: string };

/** The translation as TTS should hear it, or why it should not be spoken. */
export const prepareW3VoiceText = (line: W3VoiceLine): PrepareVoiceTtsTextResult =>
  prepareVoiceTtsText({
    lineSource: line.source,
    translation: line.translation,
    speakerSource: line.source,
    markup: WITCHER3_VOICE_MARKUP,
  });

/**
 * The clips TTS clones from: the line's own take, plus whatever the shared
 * picker adds for its speaker — the take chosen as their reference, or their
 * longer takes when this one is too short to clone from on its own.
 */
const referenceClips = async (
  line: W3VoiceLine,
  lineWav: string,
  spokenSource: string,
  options: Pick<W3LineSynthesisContext, 'db' | 'modId' | 'reference'>,
): Promise<Array<{ wavPath: string; speakerText: string }>> => {
  const own = [{ wavPath: lineWav, speakerText: spokenSource }];
  const reference = options.reference;
  const entry = w3SourceTakeEntry(line.relPath, path.dirname(lineWav));
  if (!reference || !entry) return own;
  const speakerKey = line.speakerKey === W3_UNKNOWN_SPEAKER ? null : line.speakerKey;
  const picked = await pickVoiceTtsReference({
    db: options.db,
    modId: options.modId,
    packageDir: reference.extractRoot,
    pluginRelPath: line.container,
    speakerKey,
    entry,
    lineEnglishWav: lineWav,
    lineSource: spokenSource,
    referenceMode: reference.mode,
    voiceSources: reference.voiceSources,
    getSiblingEntries: (key) => reference.siblings(key, line.id),
    speakerRefCache: reference.speakerRefCache,
    markup: WITCHER3_VOICE_MARKUP,
  });
  return picked.clips.map((clip, index) => ({
    wavPath: clip.wavPath,
    speakerText: index === 0 ? spokenSource : (clip.speakerText ?? ''),
  }));
};

export type W3LineBuffers = {
  wav: Buffer;
  audio: Buffer;
  lip: Buffer;
  voiceSimilarity: number | null;
  lipSource: string;
};

/** Synthesize and package one line in memory. */
export const synthesizeW3LineBuffers = async (
  line: W3VoiceLine,
  original: { audio: Buffer; lip: Buffer },
  prepared: Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>,
  options: Pick<
    W3LineSynthesisContext,
    | 'db'
    | 'modId'
    | 'ttsBaseUrl'
    | 'synthesis'
    | 'tgtLang'
    | 'model'
    | 'modelPath'
    | 'reference'
    | 'tempRoot'
    | 'signal'
    | 'resynth'
  >,
): Promise<W3LineBuffers> => {
  const workDir = path.join(options.tempRoot, `w3_${line.id}`);
  ensureDir(workDir);
  try {
    const reference = path.join(workDir, 'reference.wav');
    await decodeOpusWemToWav(parseW3SpeechAudio(original.audio).take, reference, {
      sampleRate: REFERENCE_SAMPLE_RATE,
    });
    const spokenSource = prepared.speakerText ?? line.source;
    const clips = await referenceClips(line, reference, spokenSource, options);
    const tts = await synthesizeWav(
      prepared.text,
      clips.map((clip) => ({
        wavPath: clip.wavPath,
        speakerText:
          stripVoiceNonSpeechBlocks(clip.speakerText, WITCHER3_VOICE_MARKUP) || undefined,
      })),
      {
        baseUrl: options.ttsBaseUrl,
        language: resolveTtsLanguage(options.tgtLang),
        synthesis: await voiceLineSynthesisParams(options.db, options.synthesis, options.resynth),
        signal: options.signal,
      },
    );
    const ttsPath = path.join(workDir, 'tts.wav');
    fs.writeFileSync(ttsPath, tts.wav);
    const built = await buildW3Take({
      audioPath: ttsPath,
      originalAudio: original.audio,
      originalLip: original.lip,
      model: options.model,
      modelPath: options.modelPath,
    });
    return {
      wav: tts.wav,
      audio: built.audio,
      lip: built.lip,
      voiceSimilarity: tts.voiceSimilarity,
      lipSource: built.lipSource,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};

/** Synthesize one line into the localize directory, unless it is already current. */
export const synthesizeW3VoiceLine = async (
  line: W3VoiceLine,
  original: { audio: Buffer; lip: Buffer },
  ctx: W3LineSynthesisContext,
): Promise<W3LineSynthesisResult> => {
  const paths = w3LocalizedTakePaths(line.container, line.id);
  const prepared = prepareW3VoiceText(line);
  if (prepared.action !== 'synthesize') {
    return { kind: 'skipped', relPath: paths.wav, reason: prepared.reason };
  }
  const lineKey = String(line.id);
  const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, ctx.tgtLang);
  const stored = lookupVoiceSynthesisVersion(
    ctx.storedVersions,
    line.speakerKey,
    lineKey,
    W3_VOICE_VARIANT,
  );
  const wavDest = path.join(ctx.localizeDir, paths.wav);
  const due = voiceTakeNeedsWork({
    force: ctx.force,
    resynth: ctx.resynth,
    speakerKey: line.speakerKey,
    lineKey,
    variant: W3_VOICE_VARIANT,
    storedVersion: stored,
    payloadVersion,
    fileExists: fs.existsSync(wavDest),
  });
  if (!due) return { kind: 'skipped', relPath: paths.wav, reason: 'current' };

  try {
    const built = await synthesizeW3LineBuffers(line, original, prepared, ctx);
    const [wavPath, audioPath, lipPath] = [paths.wav, paths.audio, paths.lip].map((rel) =>
      path.join(ctx.localizeDir, rel),
    );
    // The `.wav` first: blocks older than their `.wav` count as stale (see
    // `pack.ts`), so blocks written after it are current, and a run cut off in
    // between leaves a `.wav` whose blocks the pack rebuilds.
    const writeTake = (): void => {
      ensureDir(path.dirname(wavPath!));
      fs.writeFileSync(wavPath!, built.wav);
      fs.writeFileSync(audioPath!, built.audio);
      fs.writeFileSync(lipPath!, built.lip);
    };
    if (ctx.resynth) {
      const take = {
        modId: ctx.modId,
        lineKey,
        variant: W3_VOICE_VARIANT,
        targetLang: ctx.tgtLang,
        speakerKey: line.speakerKey,
      };
      const settled = await settleVoiceResynthTake(
        ctx.db,
        ctx.resynth,
        take,
        { payloadVersion, newSimilarity: built.voiceSimilarity },
        writeTake,
      );
      if (settled.kind === 'kept') {
        log.info(`Witcher 3 voice ${paths.wav} kept (${settled.reason})`);
        return {
          kind: 'kept',
          relPath: paths.wav,
          reason: settled.reason,
          voiceSimilarity:
            lookupVoiceResynthStamp(ctx.resynth, line.speakerKey, lineKey, W3_VOICE_VARIANT)
              ?.voiceSimilarity ?? null,
        };
      }
      ctx.storedVersions.set(
        voiceSynthesisStateKey(line.speakerKey, lineKey, W3_VOICE_VARIANT),
        payloadVersion,
      );
      log.info(`Witcher 3 voice ${paths.wav} (lip: ${built.lipSource})`);
      return {
        kind: 'written',
        relPath: paths.wav,
        voiceSimilarity: built.voiceSimilarity,
        lipSource: built.lipSource,
      };
    }
    writeTake();
    await upsertVoiceSynthesisState(ctx.db, {
      modId: ctx.modId,
      lineKey,
      variant: W3_VOICE_VARIANT,
      speakerKey: line.speakerKey,
      targetLang: ctx.tgtLang,
      ttsTextVersion: payloadVersion,
      voiceSimilarity: built.voiceSimilarity,
    });
    ctx.storedVersions.set(
      voiceSynthesisStateKey(line.speakerKey, lineKey, W3_VOICE_VARIANT),
      payloadVersion,
    );
    log.info(`Witcher 3 voice ${paths.wav} (lip: ${built.lipSource})`);
    return {
      kind: 'written',
      relPath: paths.wav,
      voiceSimilarity: built.voiceSimilarity,
      lipSource: built.lipSource,
    };
  } catch (err) {
    if (ctx.signal?.aborted) return { kind: 'skipped', relPath: paths.wav, reason: 'cancelled' };
    if (isDependencyUnavailableError(err)) throw err;
    const message = `${line.relPath}: ${err instanceof Error ? err.message : String(err)}`;
    log.warn(`Witcher 3 voice synthesis failed ${message}`);
    return { kind: 'warning', message };
  }
};
