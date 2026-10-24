/**
 * Re-synthesis of takes whose clone score came out low.
 *
 * A `low-similarity` job differs from a `missing` one in three places, and all
 * three live here so the games share them: which takes it picks (stamped, scored
 * below the threshold, and not yet handled by this run), which retry policy it
 * synthesizes with (the job's own, not the live project settings), and whether
 * the new take may replace the old one (never a worse one, unless asked).
 *
 * The run id is what makes a resumed job pick up where it stopped: every take
 * the run handled carries it in `voice_synthesis_state.resynth_run_id`, whether
 * the file was replaced or kept, so the restarted job sees them as done. A take
 * that failed in TTS carries no mark and is tried again.
 */
import type { Tx } from '../db';
import {
  clampTtsRetries,
  clampTtsRetryBelow,
  TTS_SYNTHESIS_DEFAULTS,
  type TtsSynthesisParams,
} from '../tts/ttsSynthesisParams';
import { isVoiceSynthesisCurrent } from './voiceTtsPayloadVersion';
import { withLiveRetryPolicy } from './voiceProjectSettings';
import {
  loadVoiceSynthesisStampMap,
  lookupVoiceSynthesisEntry,
  markVoiceResynthHandled,
  upsertVoiceSynthesisState,
  type VoiceSynthesisStamp,
  type VoiceSynthesisStampMap,
  type VoiceSynthesisStateRow,
} from './voiceSynthesisState';

/** What the user chose in the dialog, plus the id that ties a resumed job to its run. */
export type VoiceResynthParams = {
  /** The first job id of this run; a resumed job keeps it. */
  runId: number;
  /** Takes scoring below this are re-synthesized. */
  similarityBelow: number;
  /** Retry until a take scores at least this. */
  targetSimilarity: number;
  /** How many extra takes to try; the retry budget of this job alone. */
  retries: number;
  /** Keep the old take when the new one does not score higher. */
  noWorse: boolean;
};

/** The dialog's fields as a job carries them; anything missing falls back to the project settings. */
export type VoiceResynthJobInput = {
  runId?: number;
  similarityBelow?: number;
  targetSimilarity?: number;
  retries?: number;
  noWorse?: boolean;
};

/**
 * Fill in and clamp a job's resynth params. The threshold defaults to the
 * retry gate, the target to at least the threshold (a lower target would stop
 * retrying before the take could leave the set it was picked from).
 */
export const resolveVoiceResynthParams = (
  input: VoiceResynthJobInput,
  jobId: number,
  settings: TtsSynthesisParams,
): VoiceResynthParams => {
  const gate = settings.retryBelow ?? TTS_SYNTHESIS_DEFAULTS.retryBelow;
  const similarityBelow = clampTtsRetryBelow(input.similarityBelow ?? gate);
  return {
    runId: input.runId ?? jobId,
    similarityBelow,
    targetSimilarity: clampTtsRetryBelow(input.targetSimilarity ?? Math.max(similarityBelow, gate)),
    retries: clampTtsRetries(input.retries ?? settings.retries ?? TTS_SYNTHESIS_DEFAULTS.retries),
    noWorse: input.noWorse ?? true,
  };
};

/** The params with the stamps the job's picks are judged against. */
export type VoiceResynthContext = {
  params: VoiceResynthParams;
  stamps: VoiceSynthesisStampMap;
};

export const loadVoiceResynthContext = async (
  db: Tx,
  modId: number,
  tgtLang: string,
  params: VoiceResynthParams,
): Promise<VoiceResynthContext> => ({
  params,
  stamps: await loadVoiceSynthesisStampMap(db, modId, tgtLang),
});

export const lookupVoiceResynthStamp = (
  ctx: VoiceResynthContext,
  speakerKey: string | null | undefined,
  lineKey: string,
  variant: number,
  origin?: string | null,
): VoiceSynthesisStamp | null =>
  lookupVoiceSynthesisEntry(ctx.stamps, speakerKey, lineKey, variant, origin);

export type VoiceTakeCheck = {
  /** Synthesize even a current take (`scope=all`). */
  force: boolean;
  /** Set for a `low-similarity` job; wins over `force`. */
  resynth?: VoiceResynthContext;
  speakerKey: string | null | undefined;
  lineKey: string;
  variant: number;
  /** Plugin that owns the line, for games whose stamps carry one (Creation Engine). */
  origin?: string | null;
  storedVersion: string | null;
  payloadVersion: string;
  fileExists: boolean;
};

/**
 * Does the job synthesize this take? The one answer shared by a game's work
 * count and its synthesis loop, so the progress total matches the work.
 *
 * A low-similarity job wants a take that exists and was scored below the
 * threshold — a stale text does not exempt it, a missing score (never scored,
 * or synthesized before the gateway reported one) does — and that this run has
 * not handled yet. Otherwise a take is due when forced, or when absent or stale.
 */
export const voiceTakeNeedsWork = (check: VoiceTakeCheck): boolean => {
  if (check.resynth) {
    const stamp = lookupVoiceResynthStamp(
      check.resynth,
      check.speakerKey,
      check.lineKey,
      check.variant,
      check.origin,
    );
    const { runId, similarityBelow } = check.resynth.params;
    return (
      check.fileExists &&
      stamp != null &&
      stamp.voiceSimilarity != null &&
      stamp.voiceSimilarity < similarityBelow &&
      stamp.resynthRunId !== runId
    );
  }
  if (check.force) return true;
  return !isVoiceSynthesisCurrent(check.storedVersion, check.payloadVersion, check.fileExists);
};

/** The retry policy a line is synthesized with: the job's own for a resynth, else the live settings. */
export const voiceLineSynthesisParams = async (
  db: Tx,
  synthesis: TtsSynthesisParams,
  resynth: VoiceResynthContext | undefined,
): Promise<TtsSynthesisParams> =>
  resynth
    ? {
        ...synthesis,
        retryBelow: resynth.params.targetSimilarity,
        retries: resynth.params.retries,
      }
    : withLiveRetryPolicy(db, synthesis);

export type VoiceResynthVerdict = { replace: true } | { replace: false; reason: string };

const fmt = (score: number | null): string => (score == null ? 'n/a' : score.toFixed(3));

/**
 * May the new take replace the old one? A stale text always may: the old take
 * says something else. With "no worse" on, a current take is replaced only by a
 * take that scored higher; a new take without a score cannot prove that.
 */
export const judgeVoiceResynthTake = (
  ctx: VoiceResynthContext,
  take: { textCurrent: boolean; oldSimilarity: number | null; newSimilarity: number | null },
): VoiceResynthVerdict => {
  if (!ctx.params.noWorse || !take.textCurrent) return { replace: true };
  if (take.newSimilarity == null) {
    return { replace: false, reason: `no score for the new take; kept ${fmt(take.oldSimilarity)}` };
  }
  if (take.oldSimilarity != null && take.newSimilarity <= take.oldSimilarity) {
    return {
      replace: false,
      reason: `no improvement: ${fmt(take.oldSimilarity)} → ${fmt(take.newSimilarity)}`,
    };
  }
  return { replace: true };
};

export type VoiceResynthTakeOutcome = { kind: 'replaced' } | { kind: 'kept'; reason: string };

/**
 * Judge the new take against the stored one and record the outcome: the stamp
 * of a replaced take carries the new score and this run; a kept take only gets
 * the run mark. The caller writes the file when told to.
 */
export const settleVoiceResynthTake = async (
  db: Tx,
  ctx: VoiceResynthContext,
  take: Pick<
    VoiceSynthesisStateRow,
    'modId' | 'lineKey' | 'variant' | 'targetLang' | 'speakerKey' | 'originPlugin'
  >,
  outcome: { payloadVersion: string; newSimilarity: number | null },
  writeFile: () => void,
): Promise<VoiceResynthTakeOutcome> => {
  const stamp = lookupVoiceResynthStamp(
    ctx,
    take.speakerKey,
    take.lineKey,
    take.variant,
    take.originPlugin,
  );
  const verdict = judgeVoiceResynthTake(ctx, {
    textCurrent: stamp?.ttsTextVersion === outcome.payloadVersion,
    oldSimilarity: stamp?.voiceSimilarity ?? null,
    newSimilarity: outcome.newSimilarity,
  });
  if (!verdict.replace) {
    await markVoiceResynthHandled(db, take, ctx.params.runId);
    return { kind: 'kept', reason: verdict.reason };
  }
  writeFile();
  await upsertVoiceSynthesisState(db, {
    ...take,
    ttsTextVersion: outcome.payloadVersion,
    voiceSimilarity: outcome.newSimilarity,
    resynthRunId: ctx.params.runId,
  });
  return { kind: 'replaced' };
};
