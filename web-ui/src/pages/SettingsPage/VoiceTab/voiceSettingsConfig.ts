export type TtsBackend = 'xtts' | 'fish-speech';

export type VoiceRegenerateParams = {
  backend: TtsBackend;
  line_reference: boolean;
  speed: number;
  length_penalty: number;
  temperature: number;
  repetition_penalty: number;
  top_p: number;
  top_k: number;
  enable_text_splitting: boolean;
};

export type VoiceProjectSettings = VoiceRegenerateParams;

export const VOICE_SETTINGS_DEFAULTS: VoiceProjectSettings = {
  line_reference: true,
  backend: 'xtts',
  speed: 1.0,
  length_penalty: 2,
  temperature: 0.65,
  repetition_penalty: 1.2,
  top_p: 0.8,
  top_k: 50,
  enable_text_splitting: false,
};

export type NumericVoiceKey = Exclude<
  {
    [K in keyof VoiceProjectSettings]: VoiceProjectSettings[K] extends number ? K : never;
  }[keyof VoiceProjectSettings],
  never
>;

export const VOICE_SYNTHESIS_SLIDERS: Array<{
  key: NumericVoiceKey;
  labelKey: string;
  descKey: string;
  min: number;
  max: number;
  step: number;
  backends: TtsBackend[] | 'all';
}> = [
  {
    key: 'speed',
    labelKey: 'settings.voice.speed',
    descKey: 'settings.voice.speedDesc',
    min: 0.5,
    max: 2,
    step: 0.05,
    backends: ['xtts'],
  },
  {
    key: 'length_penalty',
    labelKey: 'settings.voice.lengthPenalty',
    descKey: 'settings.voice.lengthPenaltyDesc',
    min: 0.5,
    max: 5,
    step: 0.05,
    backends: ['xtts'],
  },
  {
    key: 'temperature',
    labelKey: 'settings.voice.temperature',
    descKey: 'settings.voice.temperatureDesc',
    min: 0,
    max: 1,
    step: 0.05,
    backends: 'all',
  },
  {
    key: 'repetition_penalty',
    labelKey: 'settings.voice.repetitionPenalty',
    descKey: 'settings.voice.repetitionPenaltyDesc',
    min: 1,
    max: 5,
    step: 0.1,
    backends: 'all',
  },
  {
    key: 'top_p',
    labelKey: 'settings.voice.topP',
    descKey: 'settings.voice.topPDesc',
    min: 0,
    max: 1,
    step: 0.05,
    backends: 'all',
  },
  {
    key: 'top_k',
    labelKey: 'settings.voice.topK',
    descKey: 'settings.voice.topKDesc',
    min: 1,
    max: 200,
    step: 1,
    backends: ['xtts'],
  },
];

export const VOICE_BACKEND_OPTIONS: Array<{
  value: TtsBackend;
  labelKey: string;
  descKey: string;
}> = [
  {
    value: 'xtts',
    labelKey: 'settings.voice.backendXtts',
    descKey: 'settings.voice.backendXttsDesc',
  },
  {
    value: 'fish-speech',
    labelKey: 'settings.voice.backendFishSpeech',
    descKey: 'settings.voice.backendFishSpeechDesc',
  },
];

export const sliderAppliesToBackend = (
  backends: TtsBackend[] | 'all',
  backend: TtsBackend,
): boolean => backends === 'all' || backends.includes(backend);

export const VOICE_REGENERATE_KEEP_CURRENT_ID = 'current';
