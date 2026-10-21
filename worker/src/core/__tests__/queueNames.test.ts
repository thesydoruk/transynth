import { JOB_KINDS } from '../../types';
import {
  JOB_KIND_SPECS,
  JOB_QUEUE_IDS,
  QUEUE_NAME_BY_ID,
  kindsOnQueue,
  queueConcurrency,
  servedQueueIds,
} from '../jobKinds';
import {
  ALL_QUEUE_NAMES,
  JOBS_QUEUE_NAME,
  LLM_QUEUE_NAME,
  VOICE_QUEUE_NAME,
  isLlmJobKind,
  queueNameForKind,
} from '../queueNames';

describe('queueNameForKind', () => {
  it('sends voice synthesis to the serial voice queue', () => {
    expect(queueNameForKind('voice-generate')).toBe(VOICE_QUEUE_NAME);
  });

  it('sends LLM pipelines to the serial LLM queue', () => {
    expect(queueNameForKind('llm-translate')).toBe(LLM_QUEUE_NAME);
    expect(queueNameForKind('llm-verify')).toBe(LLM_QUEUE_NAME);
    expect(queueNameForKind('skip-detect')).toBe(LLM_QUEUE_NAME);
    expect(queueNameForKind('gender-detect')).toBe(LLM_QUEUE_NAME);
    expect(queueNameForKind('batch-translate')).toBe(LLM_QUEUE_NAME);
  });

  it('keeps TM apply and imports on the general queue', () => {
    expect(queueNameForKind('tm-apply')).toBe(JOBS_QUEUE_NAME);
    expect(queueNameForKind('mod-import')).toBe(JOBS_QUEUE_NAME);
    expect(queueNameForKind('csv-import')).toBe(JOBS_QUEUE_NAME);
    expect(queueNameForKind('eet-import')).toBe(JOBS_QUEUE_NAME);
    expect(queueNameForKind('apply-imported')).toBe(JOBS_QUEUE_NAME);
    expect(queueNameForKind('langpack-export')).toBe(JOBS_QUEUE_NAME);
  });

  it('routes every registered kind', () => {
    for (const kind of JOB_KINDS) {
      expect(queueNameForKind(kind)).toMatch(/^transynth-/);
    }
  });
});

describe('job kind specs', () => {
  it('declares a queue and the services every kind needs', () => {
    for (const kind of JOB_KINDS) {
      expect(JOB_QUEUE_IDS).toContain(JOB_KIND_SPECS[kind].queue);
    }
    expect(JOB_KIND_SPECS['voice-generate'].needs).toContain('tts');
    expect(JOB_KIND_SPECS['llm-translate'].needs).toContain('llm');
    expect(JOB_KIND_SPECS['mod-import'].needs).toEqual([]);
    expect(kindsOnQueue('tts')).toEqual(['voice-generate']);
  });

  it('keeps the historical queue names and lists every queue once', () => {
    expect(QUEUE_NAME_BY_ID.cpu).toBe('transynth-jobs');
    expect(QUEUE_NAME_BY_ID.tts).toBe('transynth-voice');
    expect(new Set(ALL_QUEUE_NAMES).size).toBe(JOB_QUEUE_IDS.length);
    for (const id of JOB_QUEUE_IDS) expect(ALL_QUEUE_NAMES).toContain(QUEUE_NAME_BY_ID[id]);
  });

  it('reads WORKER_QUEUES and per-queue concurrency from the environment', () => {
    expect(servedQueueIds({})).toEqual([...JOB_QUEUE_IDS]);
    expect(servedQueueIds({ WORKER_QUEUES: 'llm, TTS' })).toEqual(['llm', 'tts']);
    expect(servedQueueIds({ WORKER_QUEUES: 'bogus' })).toEqual([...JOB_QUEUE_IDS]);
    expect(queueConcurrency('cpu', {}, 8)).toBe(8);
    expect(queueConcurrency('llm', {})).toBe(1);
    expect(queueConcurrency('tts', { JOB_CONCURRENCY_TTS: '3' })).toBe(3);
    expect(queueConcurrency('asr', { JOB_CONCURRENCY_ASR: '0' })).toBe(1);
  });
});

describe('isLlmJobKind', () => {
  it('excludes tm-apply and voice-generate', () => {
    expect(isLlmJobKind('tm-apply')).toBe(false);
    expect(isLlmJobKind('voice-generate')).toBe(false);
    expect(isLlmJobKind('llm-translate')).toBe(true);
  });
});
