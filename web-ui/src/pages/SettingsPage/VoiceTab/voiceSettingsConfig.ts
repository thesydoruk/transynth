export type VoiceRegenerateParams = {
  line_reference: boolean;
};

export type VoiceProjectSettings = VoiceRegenerateParams;

export const VOICE_SETTINGS_DEFAULTS: VoiceProjectSettings = {
  line_reference: true,
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

export const VOICE_REGENERATE_KEEP_CURRENT_ID = 'current';

export const GAME_TTS_MATCH_TOGGLES: Array<{
  field: keyof GameTtsMatchSettings;
  labelKey: string;
  descKey: string;
}> = [
  {
    field: 'matchTiming',
    labelKey: 'settings.voice.matchTiming',
    descKey: 'settings.voice.matchTimingDesc',
  },
];
