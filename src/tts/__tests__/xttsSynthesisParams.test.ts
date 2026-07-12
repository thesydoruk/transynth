import { resolveTtsSynthesisParams, XTTS_GAME_DIALOGUE_DEFAULTS } from '../xttsSynthesisParams';

describe('resolveTtsSynthesisParams', () => {
  it('uses quicker game-dialogue defaults when overrides are unset', () => {
    expect(resolveTtsSynthesisParams()).toEqual(XTTS_GAME_DIALOGUE_DEFAULTS);
  });

  it('allows per-call overrides on top of defaults', () => {
    expect(resolveTtsSynthesisParams({ speed: 1.15 })).toMatchObject({
      speed: 1.15,
      lengthPenalty: 1.2,
      enableTextSplitting: false,
    });
  });

  it('merges project-style overrides', () => {
    expect(
      resolveTtsSynthesisParams({
        speed: 1.18,
        lengthPenalty: 1.25,
        repetitionPenalty: 3,
        topK: 40,
        topP: 0.9,
        enableTextSplitting: true,
      }),
    ).toMatchObject({
      speed: 1.18,
      lengthPenalty: 1.25,
      repetitionPenalty: 3,
      topK: 40,
      topP: 0.9,
      enableTextSplitting: true,
    });
  });
});
