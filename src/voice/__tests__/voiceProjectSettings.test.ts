import { SETTING_DEFAULTS } from '../../web/services/projectSettings';
import {
  voiceReferenceModeFromProjectSettings,
  voiceSynthesisFromProjectSettings,
} from '../voiceProjectSettings';
import { resolveTtsReferenceMode } from '../voiceToolPaths';

describe('voiceProjectSettings', () => {
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
});

describe('resolveTtsReferenceMode', () => {
  it('defaults to speaker when project settings are unavailable', () => {
    expect(resolveTtsReferenceMode()).toBe('speaker');
  });
});
