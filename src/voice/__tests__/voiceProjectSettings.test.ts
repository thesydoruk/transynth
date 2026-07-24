import { SETTING_DEFAULTS } from '../../web/services/projectSettings';
import {
  voiceBackendFromProjectSettings,
  voiceReferenceModeFromProjectSettings,
  voiceSynthesisFromProjectSettings,
  voiceTtsMaxParallelFromProjectSettings,
} from '../voiceProjectSettings';
import { resolveTtsReferenceMode } from '../voiceToolPaths';

describe('voiceProjectSettings', () => {
  it('maps backend setting to TTS API backend field', () => {
    expect(voiceBackendFromProjectSettings(SETTING_DEFAULTS)).toBe('xtts');
    expect(
      voiceBackendFromProjectSettings({
        ...SETTING_DEFAULTS,
        'voice.backend': 'fish-speech',
      }),
    ).toBe('fish-speech');
  });

  it('falls back to xtts for unknown backend values', () => {
    expect(
      voiceBackendFromProjectSettings({
        ...SETTING_DEFAULTS,
        'voice.backend': 'unknown' as 'xtts',
      }),
    ).toBe('xtts');
  });
  it('maps line reference toggle to XTTS reference mode', () => {
    expect(voiceReferenceModeFromProjectSettings(SETTING_DEFAULTS)).toBe('line');
    expect(
      voiceReferenceModeFromProjectSettings({
        ...SETTING_DEFAULTS,
        'voice.line_reference': false,
      }),
    ).toBe('speaker');
  });

  it('maps voice synthesis settings to XTTS params', () => {
    expect(voiceSynthesisFromProjectSettings(SETTING_DEFAULTS)).toEqual({
      temperature: 0.65,
      lengthPenalty: 2,
      repetitionPenalty: 1.2,
      topK: 50,
      topP: 0.8,
      speed: 1,
      enableTextSplitting: false,
    });
  });

  it('maps per-backend TTS concurrency from project settings', () => {
    expect(voiceTtsMaxParallelFromProjectSettings(SETTING_DEFAULTS)).toEqual({
      xtts: 1,
      'fish-speech': 1,
    });
    expect(
      voiceTtsMaxParallelFromProjectSettings({
        ...SETTING_DEFAULTS,
        'voice.tts_max_parallel_xtts': 4,
        'voice.tts_max_parallel_fish_speech': 2,
      }),
    ).toEqual({
      xtts: 4,
      'fish-speech': 2,
    });
  });
});

describe('resolveTtsReferenceMode', () => {
  it('defaults to speaker when project settings are unavailable', () => {
    expect(resolveTtsReferenceMode()).toBe('speaker');
  });
});
