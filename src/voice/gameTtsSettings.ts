/**
 * Per-game xtts-engine match flags (loudness / timing).
 *
 * Stored as project setting `voice.game_tts`: a map of game id → flags.
 * Missing games fall back to both flags on.
 */

export type GameTtsMatchSettings = {
  matchLoudness: boolean;
  matchTiming: boolean;
};

export type GameTtsSettingsMap = Record<string, GameTtsMatchSettings>;

export const GAME_TTS_MATCH_DEFAULTS: GameTtsMatchSettings = {
  matchLoudness: true,
  matchTiming: true,
};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** Drop invalid entries; fill missing booleans from defaults. */
export const normalizeGameTtsSettings = (value: unknown): GameTtsSettingsMap => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: GameTtsSettingsMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const gameId = key.trim();
    if (!gameId || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    out[gameId] = {
      matchLoudness: asBoolean(row.matchLoudness, GAME_TTS_MATCH_DEFAULTS.matchLoudness),
      matchTiming: asBoolean(row.matchTiming, GAME_TTS_MATCH_DEFAULTS.matchTiming),
    };
  }
  return out;
};

/** Resolve match flags for one game; unknown or omitted games use defaults. */
export const gameTtsMatchFor = (
  map: GameTtsSettingsMap | undefined,
  game: string | null | undefined,
): GameTtsMatchSettings => {
  if (!game) return GAME_TTS_MATCH_DEFAULTS;
  return map?.[game] ?? GAME_TTS_MATCH_DEFAULTS;
};
