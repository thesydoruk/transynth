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

  it('maps Fish Speech sampling params from project settings', () => {
    expect(voiceSynthesisFromProjectSettings(SETTING_DEFAULTS)).toEqual({
      temperature: 0.65,
      repetitionPenalty: 1.2,
      topP: 0.8,
    });
    expect(
      voiceSynthesisFromProjectSettings({
        ...SETTING_DEFAULTS,
        'voice.temperature': 0.5,
        'voice.repetition_penalty': 2.5,
        'voice.top_p': 0.9,
      }),
    ).toEqual({
      temperature: 0.5,
      repetitionPenalty: 2.5,
      topP: 0.9,
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
