/**
 * Measure the vocal effort of a mod's original takes and store which lines
 * get an effort tag.
 *
 * Every take is decoded and measured once (the slow part — a base game has
 * over a hundred thousand); a later run measures only the takes it has not
 * seen and then decides again for all of them, because one new take can move
 * its speaker's baseline. Nothing here synthesizes or touches a localized
 * take: the tags only take effect where a game has them switched on.
 *
 * Measurements are saved chunk by chunk (see `measureTakesInChunks`), so a
 * stopped or killed run is resumed by running it again. A stopped run does not
 * plan: the tags already in force stay until a run gets to the end.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import { gamePlugin } from '../games/registry';
import { loadModImportPaths } from '../import/mod/resolvePaths';
import { loadImportedMod } from '../modImport';
import { ensureDir } from '../utils/file';
import type { VoiceFileEntry } from './discoverVoiceFiles';
import { voiceTranslationMapKey } from './loadVoiceTranslations';
import { measureTakesInChunks, type MeasureTakesResult } from './measureTakesInChunks';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { canSynthesizeVoiceLine } from './prepareVoiceTtsText';
import { saveClipEffortFeatures } from './saveClipEffortFeatures';
import { readPcmFromWav } from './speakerReference/pcm';
import {
  buildSpeakerBaselines,
  extractEffortFeatures,
  planVocalEffort,
  type EffortClip,
  type EffortFeatures,
} from './vocalEffort';
import { loadClipEffortFeatures, saveClipEffort, type ClipEffortRow } from './voiceEffortStore';
import { voiceSynthesisStateKey } from './voiceSynthesisState';

export type AnalyzeVocalEffortResult = {
  modId: number;
  /** Original takes the mod ships. */
  takes: number;
  /** Takes decoded and measured in this run. */
  measured: number;
  /** Takes that could not be decoded; they are tried again next time. */
  failed: number;
  /** Takes whose line has words to say; grunts and sound labels are never tagged. */
  spokenTakes: number;
  /** Of `spokenTakes`, the takes that were judged: measured, and their speaker has a baseline. */
  judgedTakes: number;
  speakers: number;
  /** Speakers with enough calm lines to be judged. */
  speakersWithBaseline: number;
  /** Takes of the speakers without a baseline — how much the small voices leave out. */
  takesWithoutBaseline: number;
  shouting: number;
  loud: number;
  skipped: boolean;
  reason?: string;
  /** Stopped before every take was measured; nothing was planned. */
  cancelled?: boolean;
};

export type AnalyzeVocalEffortOptions = {
  workers?: number;
  /** Measure every take again instead of only the new ones. */
  force?: boolean;
  log?: (message: string) => void;
  /**
   * Takes with a measurement out of all the mod's takes: first with what earlier
   * runs left, then after every take this run handles (a failed one counts too).
   */
  onProgress?: (done: number, total: number) => void;
  /** Checked before each take; a stop keeps what was measured and skips planning. */
  shouldCancel?: () => boolean;
  /** Takes per saved chunk — what a killed run can lose at most. */
  chunkSize?: number;
};

const DEFAULT_CHUNK_SIZE = 500;

const measureTake = async (
  entry: VoiceFileEntry,
  workDir: string,
): Promise<EffortFeatures | null> => {
  ensureDir(workDir);
  try {
    const { samples, sampleRate } = readPcmFromWav(await prepareReferenceAudio(entry, workDir));
    return extractEffortFeatures(samples, sampleRate);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};

export const analyzeModVocalEffort = async (
  db: Tx,
  modId: number,
  options: AnalyzeVocalEffortOptions = {},
): Promise<AnalyzeVocalEffortResult> => {
  const log = options.log ?? (() => {});
  const result: AnalyzeVocalEffortResult = {
    modId,
    takes: 0,
    measured: 0,
    failed: 0,
    spokenTakes: 0,
    judgedTakes: 0,
    speakers: 0,
    speakersWithBaseline: 0,
    takesWithoutBaseline: 0,
    shouting: 0,
    loud: 0,
    skipped: false,
  };
  const skip = (reason: string): AnalyzeVocalEffortResult => ({ ...result, skipped: true, reason });

  let paths;
  try {
    paths = await loadModImportPaths(db, { modId });
  } catch (err) {
    return skip(err instanceof Error ? err.message : String(err));
  }
  const mod = await loadImportedMod(db, modId);
  const voice = gamePlugin(mod.game).voice;
  if (!voice?.loadLineDirections)
    return skip('the game records nothing about how lines are delivered');

  const catalog = await voice.loadLineCatalog(db, {
    modId,
    pluginPath: paths.pluginPath,
    srcLang: mod.srcLang,
    targetLang: paths.targetLang,
  });
  if (!catalog.ok) return skip(catalog.message);

  // One take per speaker and line; a mod can list the same file twice.
  const takes = new Map<string, { entry: VoiceFileEntry; speakerKey: string }>();
  for (const entry of catalog.voiceFiles) {
    const speakerKey = catalog.speakerKeyOf(entry);
    const key = voiceSynthesisStateKey(
      speakerKey,
      entry.lineKey,
      entry.variant,
      entry.originPlugin,
    );
    if (!takes.has(key)) takes.set(key, { entry, speakerKey });
  }
  result.takes = takes.size;

  const features = options.force
    ? new Map<string, EffortFeatures | null>()
    : await loadClipEffortFeatures(db, modId);
  const pending = [...takes].filter(([key]) => !features.has(key));
  const earlier = takes.size - pending.length;
  options.onProgress?.(earlier, takes.size);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-effort-'));
  let measuredRun: MeasureTakesResult;
  try {
    measuredRun = await measureTakesInChunks({
      pending,
      workers: options.workers ?? 4,
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      shouldCancel: options.shouldCancel,
      measure: (take, i) => measureTake(take.entry, path.join(tempRoot, String(i))),
      save: (chunk) =>
        saveClipEffortFeatures(
          db,
          modId,
          chunk.map(({ take, features: measured }) => ({
            speakerKey: take.speakerKey,
            lineKey: take.entry.lineKey,
            variant: take.entry.variant,
            originPlugin: take.entry.originPlugin,
            features: measured,
          })),
        ),
      onTake: (handled) => {
        options.onProgress?.(earlier + handled, takes.size);
        if (handled % 2000 === 0)
          log(`Vocal effort #${modId}: ${handled}/${pending.length} takes measured`);
      },
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  result.measured = measuredRun.measured;
  result.failed = measuredRun.failed;
  if (measuredRun.cancelled) return { ...result, cancelled: true };
  for (const [key, value] of measuredRun.features) features.set(key, value);

  const directions = voice.loadLineDirections(paths.pluginPath);
  const clips: EffortClip[] = [];
  for (const [key, { entry, speakerKey }] of takes) {
    if (!features.has(key)) continue;
    const lineKey = voiceTranslationMapKey(entry.lineKey, entry.variant, entry.originPlugin);
    const source = catalog.sources.get(lineKey);
    const direction = directions.get(lineKey);
    clips.push({
      key,
      speakerKey,
      features: features.get(key) ?? null,
      calmTopic: direction?.calmTopic ?? false,
      speakable: source
        ? canSynthesizeVoiceLine(source.source, source.source, source.edid, catalog.markupStyle)
        : false,
      sourceText: source?.source ?? null,
      actorNote: direction?.actorNote ?? null,
    });
  }

  const decisions = planVocalEffort(clips);
  const rows: ClipEffortRow[] = clips.map((clip) => {
    const { entry } = takes.get(clip.key)!;
    const decision = decisions.get(clip.key);
    if (decision?.tag === 'shouting') result.shouting += 1;
    if (decision?.tag === 'loud') result.loud += 1;
    return {
      speakerKey: clip.speakerKey,
      lineKey: entry.lineKey,
      variant: entry.variant,
      originPlugin: entry.originPlugin,
      features: clip.features,
      strength: decision?.strength ?? null,
      tag: decision?.tag ?? null,
    };
  });
  await saveClipEffort(db, modId, rows);

  // Half the speakers of a base game are too small for a baseline and hold a
  // fiftieth of its lines, so the result counts lines as well as speakers.
  const baselines = buildSpeakerBaselines(clips);
  result.spokenTakes = clips.filter((clip) => clip.speakable).length;
  result.judgedTakes = decisions.size;
  result.speakers = new Set(clips.map((clip) => clip.speakerKey)).size;
  result.speakersWithBaseline = baselines.size;
  result.takesWithoutBaseline = clips.filter((clip) => !baselines.has(clip.speakerKey)).length;
  return result;
};
