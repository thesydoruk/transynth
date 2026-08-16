export type VoiceRegenerateParams = {
  line_reference: boolean;
  temperature: number;
  repetition_penalty: number;
  top_p: number;
};

export type VoiceProjectSettings = VoiceRegenerateParams;

export const VOICE_SETTINGS_DEFAULTS: VoiceProjectSettings = {
  line_reference: true,
  temperature: 0.65,
  repetition_penalty: 1.2,
  top_p: 0.8,
};

export type GameTtsMatchSettings = {
  matchLoudness: boolean;
  matchTiming: boolean;
};

export type GameTtsSettingsMap = Record<string, GameTtsMatchSettings>;

export const GAME_TTS_MATCH_DEFAULTS: GameTtsMatchSettings = {
  matchLoudness: true,
  matchTiming: true,
};

export const gameTtsMatchFor = (
  map: GameTtsSettingsMap | undefined,
  gameId: string,
): GameTtsMatchSettings => ({
  ...GAME_TTS_MATCH_DEFAULTS,
  ...(map?.[gameId] ?? {}),
});

export const patchGameTtsMap = (
  map: GameTtsSettingsMap | undefined,
  gameId: string,
  patch: Partial<GameTtsMatchSettings>,
): GameTtsSettingsMap => ({
  ...(map ?? {}),
  [gameId]: { ...gameTtsMatchFor(map, gameId), ...patch },
});

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
}> = [
  {
    key: 'temperature',
    labelKey: 'settings.voice.temperature',
    descKey: 'settings.voice.temperatureDesc',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'repetition_penalty',
    labelKey: 'settings.voice.repetitionPenalty',
    descKey: 'settings.voice.repetitionPenaltyDesc',
    min: 1,
    max: 5,
    step: 0.1,
  },
  {
    key: 'top_p',
    labelKey: 'settings.voice.topP',
    descKey: 'settings.voice.topPDesc',
    min: 0,
    max: 1,
    step: 0.05,
  },
];

export const VOICE_REGENERATE_KEEP_CURRENT_ID = 'current';

export const GAME_TTS_MATCH_TOGGLES: Array<{
  field: keyof GameTtsMatchSettings;
  labelKey: string;
  descKey: string;
}> = [
  {
    field: 'matchLoudness',
    labelKey: 'settings.voice.matchLoudness',
    descKey: 'settings.voice.matchLoudnessDesc',
  },
  {
    field: 'matchTiming',
    labelKey: 'settings.voice.matchTiming',
    descKey: 'settings.voice.matchTimingDesc',
  },
];
