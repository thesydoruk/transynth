import { describe, expect, it } from '@jest/globals';
import { kindsNeededByQueue, readDemand } from '../demand';

describe('fleet demand', () => {
  it('maps queues to the kinds their jobs need', () => {
    expect(kindsNeededByQueue('tts')).toEqual(expect.arrayContaining(['tts']));
    expect(kindsNeededByQueue('llm')).toEqual(expect.arrayContaining(['llm', 'embed']));
    expect(kindsNeededByQueue('cpu')).toEqual([]);
  });

  it('folds queue counts into demand per kind', async () => {
    const demand = await readDemand(async (queue) =>
      queue === 'transynth-voice'
        ? { waiting: 2, active: 1 }
        : queue === 'transynth-llm'
          ? { waiting: 0, active: 1 }
          : { waiting: 0, active: 0 },
    );
    expect(demand.tts).toEqual({ waiting: 2, active: 1 });
    expect(demand.llm).toEqual({ waiting: 0, active: 1 });
    expect(demand.embed).toEqual({ waiting: 0, active: 1 });
    expect(demand.asr).toBeUndefined(); // no job kind needs asr yet (stage 3 adds media kinds)
    expect(demand.tools).toBeUndefined();
  });

  it('counts a kind a job signals it is waiting for as one active job', async () => {
    const demand = await readDemand(
      async (queue) =>
        queue === 'transynth-llm' ? { waiting: 0, active: 2 } : { waiting: 0, active: 0 },
      async () => ['asr', 'llm'],
    );
    expect(demand.asr).toEqual({ waiting: 0, active: 1 });
    expect(demand.llm).toEqual({ waiting: 0, active: 3 });
    expect(demand.tts).toEqual({ waiting: 0, active: 0 });
  });
});
