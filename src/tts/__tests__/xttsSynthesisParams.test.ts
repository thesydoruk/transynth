import { resolveTtsSynthesisParams, XTTS_GAME_DIALOGUE_DEFAULTS } from '../xttsSynthesisParams';

describe('resolveTtsSynthesisParams', () => {
  const envKeys = [
    'TTS_TEMPERATURE',
    'TTS_LENGTH_PENALTY',
    'TTS_REPETITION_PENALTY',
    'TTS_TOP_K',
    'TTS_TOP_P',
    'TTS_SPEED',
    'TTS_ENABLE_TEXT_SPLITTING',
  ] as const;

  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('uses quicker game-dialogue defaults when env is unset', () => {
    expect(resolveTtsSynthesisParams()).toEqual(XTTS_GAME_DIALOGUE_DEFAULTS);
  });

  it('allows per-call overrides on top of defaults', () => {
    expect(resolveTtsSynthesisParams({ speed: 1.15 })).toMatchObject({
      speed: 1.15,
      lengthPenalty: 1.2,
      enableTextSplitting: false,
    });
  });

  it('reads pacing from env', () => {
    process.env.TTS_SPEED = '1.18';
    process.env.TTS_LENGTH_PENALTY = '1.25';
    process.env.TTS_REPETITION_PENALTY = '3';
    process.env.TTS_TOP_K = '40';
    process.env.TTS_TOP_P = '0.9';
    process.env.TTS_ENABLE_TEXT_SPLITTING = 'true';

    expect(resolveTtsSynthesisParams()).toMatchObject({
      speed: 1.18,
      lengthPenalty: 1.25,
      repetitionPenalty: 3,
      topK: 40,
      topP: 0.9,
      enableTextSplitting: true,
    });
  });
});
