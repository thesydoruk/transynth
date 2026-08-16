import { resolveTtsSynthesisParams, TTS_SYNTHESIS_DEFAULTS } from '../ttsSynthesisParams';

describe('resolveTtsSynthesisParams', () => {
  it('uses Fish Speech defaults when overrides are unset', () => {
    expect(resolveTtsSynthesisParams()).toEqual(TTS_SYNTHESIS_DEFAULTS);
  });

  it('allows per-call overrides on top of defaults', () => {
    expect(resolveTtsSynthesisParams({ temperature: 0.5 })).toMatchObject({
      temperature: 0.5,
      repetitionPenalty: 1.2,
      topP: 0.8,
      matchLoudness: true,
      matchTiming: true,
    });
  });

  it('merges project-style overrides', () => {
    expect(
      resolveTtsSynthesisParams({
        temperature: 0.7,
        repetitionPenalty: 2.5,
        topP: 0.9,
        matchLoudness: false,
        matchTiming: false,
      }),
    ).toEqual({
      temperature: 0.7,
      repetitionPenalty: 2.5,
      topP: 0.9,
      matchLoudness: false,
      matchTiming: false,
    });
  });
});
