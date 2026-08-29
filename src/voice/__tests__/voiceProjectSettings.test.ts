import { SETTING_DEFAULTS } from '../../web/services/projectSettings';
import {
  voiceReferenceModeFromProjectSettings,
  voiceSynthesisFromProjectSettings,
  voiceTtsMaxParallelFromProjectSettings,
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
    });
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
