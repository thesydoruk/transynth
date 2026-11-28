import { describe, expect, it } from '@jest/globals';
import type { Tx } from '../../../../../src/db';
import type {
  AnalyzeVocalEffortOptions,
  AnalyzeVocalEffortResult,
} from '../../../../../src/voice/analyzeVocalEffort';
import { runVoiceEffortJob, type VoiceEffortProgressEvent } from '../runJob';

const db = {} as Tx;

const RESULT: AnalyzeVocalEffortResult = {
  modId: 33,
  takes: 10,
  measured: 6,
  failed: 1,
  spokenTakes: 9,
  judgedTakes: 7,
  speakers: 3,
  speakersWithBaseline: 2,
  takesWithoutBaseline: 2,
  shouting: 2,
  loud: 1,
  skipped: false,
};

const run = async (
  analyze: (options: AnalyzeVocalEffortOptions) => Promise<AnalyzeVocalEffortResult>,
  isCancelled = () => false,
) => {
  const events: VoiceEffortProgressEvent[] = [];
  let clock = 0;
  const snapshot = await runVoiceEffortJob(
    db,
    { jobId: 900, modId: 33, isCancelled },
    (event) => events.push(event),
    async (_db, _modId, options) => analyze(options),
    () => (clock += 100),
  );
  return { events, snapshot };
};

describe('runVoiceEffortJob', () => {
  it('starts with what earlier runs measured and ends with the result', async () => {
    const { events, snapshot } = await run(async (options) => {
      options.onProgress?.(3, 10);
      for (let done = 4; done <= 10; done += 1) options.onProgress?.(done, 10);
      return RESULT;
    });

    expect(events[0]).toEqual({ type: 'started', jobId: 900, total: 10 });
    expect(events[1]).toEqual({ type: 'progress', done: 3, total: 10 });
    // Throttled in between, but the last step always goes out.
    expect(events.filter((event) => event.type === 'progress').length).toBeLessThan(8);
    expect(events.at(-2)).toEqual({ type: 'progress', done: 10, total: 10 });
    expect(events.at(-1)).toEqual({ type: 'done', done: 10, total: 10, result: RESULT });
    expect(snapshot).toMatchObject({ status: 'completed', done: 10, total: 10, result: RESULT });
  });

  it('reports a stopped run as cancelled with what it measured', async () => {
    const { events, snapshot } = await run(
      async (options) => {
        options.onProgress?.(0, 10);
        options.onProgress?.(4, 10);
        return { ...RESULT, measured: 4, failed: 0, cancelled: true };
      },
      () => true,
    );

    expect(events.at(-1)).toEqual({ type: 'cancelled', done: 4, total: 10 });
    expect(snapshot).toMatchObject({ status: 'cancelled', done: 4, total: 10 });
    expect(snapshot.result?.measured).toBe(4);
  });

  it('fails with the reason when the mod cannot be analyzed', async () => {
    const { events, snapshot } = await run(async () => ({
      ...RESULT,
      skipped: true,
      reason: 'the game records nothing about how lines are delivered',
    }));

    expect(events).toEqual([
      { type: 'error', error: 'the game records nothing about how lines are delivered' },
    ]);
    expect(snapshot).toMatchObject({
      status: 'failed',
      error: 'the game records nothing about how lines are delivered',
    });
  });

  it('fails when the analysis throws', async () => {
    const { snapshot } = await run(async () => {
      throw new Error('plugin not found');
    });
    expect(snapshot).toMatchObject({ status: 'failed', error: 'plugin not found', result: null });
  });
});
