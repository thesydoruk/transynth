import { JOB_KINDS } from '../../types';
import {
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

describe('isLlmJobKind', () => {
  it('excludes tm-apply and voice-generate', () => {
    expect(isLlmJobKind('tm-apply')).toBe(false);
    expect(isLlmJobKind('voice-generate')).toBe(false);
    expect(isLlmJobKind('llm-translate')).toBe(true);
  });
});
