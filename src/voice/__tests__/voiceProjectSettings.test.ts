import { SETTING_DEFAULTS } from '../../web/services/projectSettings';
import type { Tx } from '../../db';
import {
  voiceReferenceModeFromProjectSettings,
  voiceSynthesisFromProjectSettings,
  voiceTtsMaxParallelFromProjectSettings,
  withLiveRetryPolicy,
} from '../voiceProjectSettings';
import { resolveTtsReferenceMode } from '../voiceToolPaths';

describe('voiceProjectSettings', () => {
  it('maps line reference toggle to TTS reference mode', () => {
    expect(voiceReferenceModeFromProjectSettings(SETTING_DEFAULTS)).toBe('line');
    expect(
      voiceReferenceModeFromProjectSettings({
        ...SETTING_DEFAULTS,
        'voice.line_reference': false,
      }),
    ).toBe('speaker');
  });

  it('maps per-game timing from project settings and keeps loudness on', () => {
    expect(voiceSynthesisFromProjectSettings(SETTING_DEFAULTS, 'fo4')).toEqual({
      matchLoudness: true,
      matchTiming: true,
      retryBelow: 0.3,
      retries: 4,
    });
    expect(
      voiceSynthesisFromProjectSettings(
        {
          ...SETTING_DEFAULTS,
          'voice.game_tts': { fo4: { matchLoudness: false, matchTiming: false } },
        },
        'fo4',
      ),
    ).toEqual({
      matchLoudness: true,
      matchTiming: false,
      retryBelow: 0.3,
      retries: 4,
    });
    expect(
      voiceSynthesisFromProjectSettings(
        {
          ...SETTING_DEFAULTS,
          'voice.game_tts': { fo4: { matchLoudness: false, matchTiming: false } },
        },
        'disco',
      ),
    ).toEqual({
      matchLoudness: true,
      matchTiming: true,
      retryBelow: 0.3,
      retries: 4,
    });
  });

  it('carries the retry policy from Settings → Voice → Synthesis', () => {
    expect(
      voiceSynthesisFromProjectSettings(
        { ...SETTING_DEFAULTS, 'voice.synth_retries': 2, 'voice.synth_retry_below': 0.5 },
        'fo4',
      ),
    ).toMatchObject({ retries: 2, retryBelow: 0.5 });
  });

  it('maps Fish Speech concurrency from project settings', () => {
    expect(voiceTtsMaxParallelFromProjectSettings(SETTING_DEFAULTS)).toBe(1);
    expect(
      voiceTtsMaxParallelFromProjectSettings({
        ...SETTING_DEFAULTS,
        'voice.tts_max_parallel_fish_speech': 4,
      }),
    ).toBe(4);
  });
});

describe('resolveTtsReferenceMode', () => {
  it('defaults to speaker when project settings are unavailable', () => {
    expect(resolveTtsReferenceMode()).toBe('speaker');
  });
});

describe('withLiveRetryPolicy', () => {
  const base = { matchLoudness: true, matchTiming: false, retryBelow: 0.4, retries: 8 };
  const dbWith = (rows: Array<{ key: string; value: unknown }>): Tx =>
    ({ query: async () => ({ rows }) }) as unknown as Tx;

  it('replaces the retry policy with what the database holds now and keeps the match flags', async () => {
    const db = dbWith([
      { key: 'voice.synth_retry_below', value: 0.35 },
      { key: 'voice.synth_retries', value: 3 },
    ]);
    expect(await withLiveRetryPolicy(db, base)).toEqual({
      matchLoudness: true,
      matchTiming: false,
      retryBelow: 0.35,
      retries: 3,
    });
  });

  it('falls back to the built-in defaults when the keys are unset, and clamps stored values', async () => {
    expect(await withLiveRetryPolicy(dbWith([]), base)).toMatchObject({
      retryBelow: SETTING_DEFAULTS['voice.synth_retry_below'],
      retries: SETTING_DEFAULTS['voice.synth_retries'],
    });
    const db = dbWith([
      { key: 'voice.synth_retry_below', value: 1.7 },
      { key: 'voice.synth_retries', value: '99' },
    ]);
    const live = await withLiveRetryPolicy(db, base);
    expect(live.retryBelow).toBe(1);
    expect(live.retries).toBeLessThanOrEqual(8);
  });
});
