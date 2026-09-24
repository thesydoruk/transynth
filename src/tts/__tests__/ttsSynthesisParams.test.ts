import {
  appendTtsSynthesisFormFields,
  resolveTtsSynthesisParams,
  TTS_SYNTHESIS_DEFAULTS,
} from '../ttsSynthesisParams';

describe('resolveTtsSynthesisParams', () => {
  it('uses defaults when overrides are unset', () => {
    expect(resolveTtsSynthesisParams()).toEqual(TTS_SYNTHESIS_DEFAULTS);
  });

  it('allows per-call overrides on top of defaults', () => {
    expect(resolveTtsSynthesisParams({ matchTiming: false })).toEqual({
      ...TTS_SYNTHESIS_DEFAULTS,
      matchTiming: false,
    });
  });

  it('merges project-style overrides', () => {
    expect(
      resolveTtsSynthesisParams({
        matchLoudness: false,
        matchTiming: false,
        retryBelow: 0.45,
        retries: 2,
      }),
    ).toEqual({
      matchLoudness: false,
      matchTiming: false,
      retryBelow: 0.45,
      retries: 2,
    });
  });

  it('clamps the retry policy into its range', () => {
    expect(resolveTtsSynthesisParams({ retries: 40, retryBelow: 7 })).toMatchObject({
      retries: 8,
      retryBelow: 1,
    });
    expect(resolveTtsSynthesisParams({ retries: -3, retryBelow: -1 })).toMatchObject({
      retries: 0,
      retryBelow: 0,
    });
  });
});

describe('appendTtsSynthesisFormFields', () => {
  it('sends the match flags and nothing about retries', () => {
    const form = new FormData();
    appendTtsSynthesisFormFields(form, { matchTiming: false, retries: 4, retryBelow: 0.3 });
    expect(form.get('match_timing')).toBe('false');
    expect([...form.keys()]).toEqual(['match_timing']);
  });
});
