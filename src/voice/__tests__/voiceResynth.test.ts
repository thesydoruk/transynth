import { describe, expect, it, jest } from '@jest/globals';
import type { Tx } from '../../db';
import {
  judgeVoiceResynthTake,
  resolveVoiceResynthParams,
  settleVoiceResynthTake,
  voiceLineSynthesisParams,
  voiceTakeNeedsWork,
  type VoiceResynthContext,
  type VoiceResynthParams,
} from '../voiceResynth';
import { voiceSynthesisStateKey, type VoiceSynthesisStamp } from '../voiceSynthesisState';

const params = (over: Partial<VoiceResynthParams> = {}): VoiceResynthParams => ({
  runId: 900,
  similarityBelow: 0.4,
  targetSimilarity: 0.45,
  retries: 6,
  noWorse: true,
  ...over,
});

const stamp = (over: Partial<VoiceSynthesisStamp> = {}): VoiceSynthesisStamp => ({
  ttsTextVersion: 'v-current',
  voiceSimilarity: 0.31,
  resynthRunId: null,
  ...over,
});

const context = (
  stamps: Array<[string, VoiceSynthesisStamp]>,
  over: Partial<VoiceResynthParams> = {},
): VoiceResynthContext => ({ params: params(over), stamps: new Map(stamps) });

const NORA = 'PlayerVoiceFemale01';
const check = (ctx: VoiceResynthContext | undefined, over: Record<string, unknown> = {}) =>
  voiceTakeNeedsWork({
    force: false,
    resynth: ctx,
    speakerKey: NORA,
    lineKey: '005825',
    variant: 1,
    storedVersion: 'v-current',
    payloadVersion: 'v-current',
    fileExists: true,
    ...over,
  });

describe('voiceTakeNeedsWork without resynth', () => {
  it('is due when forced, absent or stale, and not when current', () => {
    expect(check(undefined, { force: true })).toBe(true);
    expect(check(undefined, { fileExists: false })).toBe(true);
    expect(check(undefined, { storedVersion: 'v-old' })).toBe(true);
    expect(check(undefined, { storedVersion: null })).toBe(true);
    expect(check(undefined)).toBe(false);
  });
});

describe('voiceTakeNeedsWork for a low-similarity job', () => {
  const key = voiceSynthesisStateKey(NORA, '005825', 1);

  it('picks a stamped take scored below the threshold', () => {
    expect(check(context([[key, stamp({ voiceSimilarity: 0.31 })]]))).toBe(true);
  });

  it('leaves a take at or above the threshold alone', () => {
    expect(check(context([[key, stamp({ voiceSimilarity: 0.4 })]]))).toBe(false);
    expect(check(context([[key, stamp({ voiceSimilarity: 0.55 })]]))).toBe(false);
  });

  it("leaves an unscored take alone — that is the backfill script's job", () => {
    expect(check(context([[key, stamp({ voiceSimilarity: null })]]))).toBe(false);
  });

  it('leaves a missing take alone — that is "missing"\'s job', () => {
    expect(check(context([[key, stamp()]]), { fileExists: false })).toBe(false);
    expect(check(context([]))).toBe(false);
  });

  it('still picks a stale take when its score is low', () => {
    const ctx = context([[key, stamp({ ttsTextVersion: 'v-old' })]]);
    expect(check(ctx, { storedVersion: 'v-old' })).toBe(true);
  });

  it('skips a take this run already handled, but not one another run handled', () => {
    expect(check(context([[key, stamp({ resynthRunId: 900 })]]))).toBe(false);
    expect(check(context([[key, stamp({ resynthRunId: 123 })]]))).toBe(true);
  });

  it('ignores `force` — "all" semantics never apply to this scope', () => {
    expect(check(context([[key, stamp({ voiceSimilarity: 0.6 })]]), { force: true })).toBe(false);
  });

  it('falls back to the legacy speakerless stamp, like the version lookup does', () => {
    const legacy = voiceSynthesisStateKey('', '005825', 1);
    expect(check(context([[legacy, stamp({ voiceSimilarity: 0.2 })]]))).toBe(true);
  });

  it('keeps Nate and Nora apart on a shared FormID', () => {
    const nate = voiceSynthesisStateKey('PlayerVoiceMale01', '005825', 1);
    const ctx = context([
      [nate, stamp({ voiceSimilarity: 0.2 })],
      [key, stamp({ voiceSimilarity: 0.5 })],
    ]);
    expect(check(ctx)).toBe(false);
    expect(check(ctx, { speakerKey: 'PlayerVoiceMale01' })).toBe(true);
  });
});

describe('judgeVoiceResynthTake', () => {
  const ctx = context([]);

  it('replaces when the new take scores higher', () => {
    expect(
      judgeVoiceResynthTake(ctx, { textCurrent: true, oldSimilarity: 0.31, newSimilarity: 0.42 }),
    ).toEqual({ replace: true });
  });

  it('keeps the old take when the new one is not higher', () => {
    expect(
      judgeVoiceResynthTake(ctx, { textCurrent: true, oldSimilarity: 0.31, newSimilarity: 0.31 }),
    ).toMatchObject({ replace: false, reason: expect.stringContaining('0.310 → 0.310') });
    expect(
      judgeVoiceResynthTake(ctx, { textCurrent: true, oldSimilarity: 0.31, newSimilarity: 0.2 }),
    ).toMatchObject({ replace: false });
  });

  it('keeps the old take when the new one has no score to prove itself with', () => {
    expect(
      judgeVoiceResynthTake(ctx, { textCurrent: true, oldSimilarity: 0.31, newSimilarity: null }),
    ).toMatchObject({ replace: false, reason: expect.stringContaining('no score') });
  });

  it('always replaces a stale take — it says something else', () => {
    expect(
      judgeVoiceResynthTake(ctx, { textCurrent: false, oldSimilarity: 0.31, newSimilarity: 0.1 }),
    ).toEqual({ replace: true });
  });

  it('always replaces when "no worse" is off', () => {
    const loose = context([], { noWorse: false });
    expect(
      judgeVoiceResynthTake(loose, { textCurrent: true, oldSimilarity: 0.31, newSimilarity: 0.1 }),
    ).toEqual({ replace: true });
  });
});

describe('resolveVoiceResynthParams', () => {
  const settings = { retryBelow: 0.4, retries: 8 };

  it('takes the dialog values as they are, clamped', () => {
    expect(
      resolveVoiceResynthParams(
        { similarityBelow: 0.35, targetSimilarity: 0.5, retries: 3, noWorse: false, runId: 77 },
        901,
        settings,
      ),
    ).toEqual({
      runId: 77,
      similarityBelow: 0.35,
      targetSimilarity: 0.5,
      retries: 3,
      noWorse: false,
    });
    expect(
      resolveVoiceResynthParams({ similarityBelow: 1.7, retries: 40 }, 901, settings),
    ).toMatchObject({ similarityBelow: 1, retries: 8 });
  });

  it('falls back to the project gate, keeps the target at least the threshold, and uses the job id as run id', () => {
    expect(resolveVoiceResynthParams({}, 901, settings)).toEqual({
      runId: 901,
      similarityBelow: 0.4,
      targetSimilarity: 0.4,
      retries: 8,
      noWorse: true,
    });
    expect(resolveVoiceResynthParams({ similarityBelow: 0.5 }, 901, settings)).toMatchObject({
      targetSimilarity: 0.5,
    });
  });
});

type Query = { sql: string; args: unknown[] };
const fakeDb = (rows: unknown[] = []) => {
  const queries: Query[] = [];
  const db = {
    query: jest.fn(async (sql: string, args: unknown[] = []) => {
      queries.push({ sql, args });
      return { rows, rowCount: rows.length };
    }),
  } as unknown as Tx;
  return { db, queries };
};

describe('voiceLineSynthesisParams', () => {
  it("pins the job's own gate and budget for a resynth, ignoring the live settings", async () => {
    const { db, queries } = fakeDb([{ key: 'voice.synth_retry_below', value: 0.9 }]);
    const ctx = context([], { targetSimilarity: 0.45, retries: 6 });
    await expect(
      voiceLineSynthesisParams(db, { matchTiming: true, retryBelow: 0.4, retries: 8 }, ctx),
    ).resolves.toEqual({ matchTiming: true, retryBelow: 0.45, retries: 6 });
    expect(queries).toHaveLength(0);
  });

  it('reads the live settings for every other job', async () => {
    const { db } = fakeDb([
      { key: 'voice.synth_retry_below', value: 0.35 },
      { key: 'voice.synth_retries', value: 2 },
    ]);
    await expect(
      voiceLineSynthesisParams(db, { retryBelow: 0.4, retries: 8 }, undefined),
    ).resolves.toEqual({ retryBelow: 0.35, retries: 2 });
  });
});

describe('settleVoiceResynthTake', () => {
  const take = { modId: 33, lineKey: '005825', variant: 1, targetLang: 'uk', speakerKey: NORA };
  const key = voiceSynthesisStateKey(NORA, '005825', 1);

  it('writes the file and stamps score + run id when the take improved', async () => {
    const { db, queries } = fakeDb();
    const writeFile = jest.fn();
    const ctx = context([[key, stamp({ voiceSimilarity: 0.31 })]]);
    await expect(
      settleVoiceResynthTake(
        db,
        ctx,
        take,
        { payloadVersion: 'v-current', newSimilarity: 0.47 },
        writeFile,
      ),
    ).resolves.toEqual({ kind: 'replaced' });
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/INSERT INTO voice_synthesis_state/);
    expect(queries[0].args).toEqual([33, '005825', 1, 'uk', NORA, '', 'v-current', 0.47, 900]);
  });

  it("finds a patch take's stamp under its pre-origin row and replaces that row", async () => {
    const { db, queries } = fakeDb();
    const ctx = context([[key, stamp({ voiceSimilarity: 0.31 })]]);
    await expect(
      settleVoiceResynthTake(
        db,
        ctx,
        { ...take, originPlugin: 'Fallout4.esm' },
        { payloadVersion: 'v-current', newSimilarity: 0.47 },
        jest.fn(),
      ),
    ).resolves.toEqual({ kind: 'replaced' });
    expect(queries).toHaveLength(2);
    expect(queries[0].args).toEqual([
      33,
      '005825',
      1,
      'uk',
      NORA,
      'fallout4.esm',
      'v-current',
      0.47,
      900,
    ]);
    expect(queries[1].sql).toMatch(/DELETE FROM voice_synthesis_state[\s\S]*origin_plugin = ''/);
    expect(queries[1].args).toEqual([33, '005825', 1, 'uk', NORA]);
  });

  it('keeps the file and only marks the run when the take did not improve', async () => {
    const { db, queries } = fakeDb();
    const writeFile = jest.fn();
    const ctx = context([[key, stamp({ voiceSimilarity: 0.31 })]]);
    await expect(
      settleVoiceResynthTake(
        db,
        ctx,
        take,
        { payloadVersion: 'v-current', newSimilarity: 0.3 },
        writeFile,
      ),
    ).resolves.toMatchObject({ kind: 'kept' });
    expect(writeFile).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/UPDATE voice_synthesis_state\s+SET resynth_run_id/);
    expect(queries[0].args).toEqual([33, '005825', 1, 'uk', NORA, 900, '']);
  });

  it('judges a stale stamp as stale and replaces it regardless of the score', async () => {
    const { db } = fakeDb();
    const writeFile = jest.fn();
    const ctx = context([[key, stamp({ ttsTextVersion: 'v-old', voiceSimilarity: 0.31 })]]);
    await expect(
      settleVoiceResynthTake(
        db,
        ctx,
        take,
        { payloadVersion: 'v-current', newSimilarity: 0.1 },
        writeFile,
      ),
    ).resolves.toEqual({ kind: 'replaced' });
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});
