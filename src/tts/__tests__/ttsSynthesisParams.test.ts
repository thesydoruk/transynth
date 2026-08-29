import { resolveTtsSynthesisParams, TTS_SYNTHESIS_DEFAULTS } from '../ttsSynthesisParams';

describe('resolveTtsSynthesisParams', () => {
  it('uses defaults when overrides are unset', () => {
    expect(resolveTtsSynthesisParams()).toEqual(TTS_SYNTHESIS_DEFAULTS);
  });

  it('allows per-call overrides on top of defaults', () => {
    expect(resolveTtsSynthesisParams({ matchTiming: false })).toEqual({
      matchLoudness: true,
      matchTiming: false,
    });
  });

  it('merges project-style overrides', () => {
    expect(
      resolveTtsSynthesisParams({
        matchLoudness: false,
        matchTiming: false,
      }),
    ).toEqual({
      matchLoudness: false,
      matchTiming: false,
    });
  });
});
