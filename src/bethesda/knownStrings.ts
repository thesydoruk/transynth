/**
 * knownStrings.ts
 *
 * Per-game lookup tables of translatable subrecords loaded from JSON files.
 * JSON files under src/bethesda/subrecords are the single source of truth.
 */

import type { GameType } from '../types.js';
import fo4ConfigJson from './subrecords/fo4.json' with { type: 'json' };
import fo76ConfigJson from './subrecords/fo76.json' with { type: 'json' };
import fo3ConfigJson from './subrecords/fo3.json' with { type: 'json' };
import fnvConfigJson from './subrecords/fnv.json' with { type: 'json' };
import sseConfigJson from './subrecords/sse.json' with { type: 'json' };
import sleConfigJson from './subrecords/sle.json' with { type: 'json' };

type SubrecordToggleMap = Record<string, boolean>;

interface RecordToggleConfig {
  read: boolean;
  subrecords: SubrecordToggleMap;
}

interface GameSubrecordsConfig {
  game: GameType;
  records: Record<string, RecordToggleConfig>;
}

const GAME_SUBRECORDS_CONFIG_BY_GAME: Record<GameType, GameSubrecordsConfig> = {
  fo4: fo4ConfigJson as GameSubrecordsConfig,
  fo76: fo76ConfigJson as GameSubrecordsConfig,
  fo3: fo3ConfigJson as GameSubrecordsConfig,
  fnv: fnvConfigJson as GameSubrecordsConfig,
  sse: sseConfigJson as GameSubrecordsConfig,
  sle: sleConfigJson as GameSubrecordsConfig,
};

/**
 * Load one game's subrecord configuration from JSON.
 */
export const loadGameSubrecordsConfig = (game: GameType): GameSubrecordsConfig => {
  const parsed = GAME_SUBRECORDS_CONFIG_BY_GAME[game];

  if (parsed.game !== game) {
    throw new Error(`Subrecord config mismatch: expected ${game}, got ${parsed.game}`);
  }

  return parsed;
};

const getEnabledSubrecords = (subrecords: SubrecordToggleMap): Set<string> => {
  return new Set(
    Object.entries(subrecords)
      .filter(([, enabled]) => enabled)
      .map(([subrecord]) => subrecord),
  );
};

const toTranslatableSubrecordsMap = (
  config: GameSubrecordsConfig,
): Record<string, Set<string>> => {
  return Object.fromEntries(
    Object.entries(config.records).map(([record, toggleConfig]) => {
      return [record, getEnabledSubrecords(toggleConfig.subrecords)];
    }),
  );
};

const toIgnoredRecordsSet = (config: GameSubrecordsConfig): ReadonlySet<string> => {
  return new Set(
    Object.entries(config.records)
      .filter(([, toggleConfig]) => !toggleConfig.read)
      .map(([record]) => record),
  );
};

const validateAllGameConfigs = (): void => {
  (Object.keys(GAME_SUBRECORDS_CONFIG_BY_GAME) as GameType[]).forEach((game) => {
    loadGameSubrecordsConfig(game);
  });
};

validateAllGameConfigs();

const TRANSLATABLE_SUBRECORDS_BY_GAME: Record<GameType, Record<string, Set<string>>> = {
  fo4: toTranslatableSubrecordsMap(GAME_SUBRECORDS_CONFIG_BY_GAME.fo4),
  fo76: toTranslatableSubrecordsMap(GAME_SUBRECORDS_CONFIG_BY_GAME.fo76),
  fo3: toTranslatableSubrecordsMap(GAME_SUBRECORDS_CONFIG_BY_GAME.fo3),
  fnv: toTranslatableSubrecordsMap(GAME_SUBRECORDS_CONFIG_BY_GAME.fnv),
  sse: toTranslatableSubrecordsMap(GAME_SUBRECORDS_CONFIG_BY_GAME.sse),
  sle: toTranslatableSubrecordsMap(GAME_SUBRECORDS_CONFIG_BY_GAME.sle),
};

/**
 * Fallout 4 translatable subrecords.
 */
export const FO4_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fo4;

/**
 * Fallout 76 translatable subrecords.
 */
export const FO76_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fo76;

/**
 * Skyrim SE translatable subrecords.
 */
export const SSE_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.sse;

/**
 * Fallout 3 translatable subrecords.
 */
export const FO3_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fo3;

/**
 * Fallout: New Vegas translatable subrecords.
 */
export const FNV_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fnv;

/**
 * Records marked as not-readable for each game.
 */
export const IGNORED_RECORDS_BY_GAME: Record<GameType, ReadonlySet<string>> = {
  fo4: toIgnoredRecordsSet(GAME_SUBRECORDS_CONFIG_BY_GAME.fo4),
  fo76: toIgnoredRecordsSet(GAME_SUBRECORDS_CONFIG_BY_GAME.fo76),
  fo3: toIgnoredRecordsSet(GAME_SUBRECORDS_CONFIG_BY_GAME.fo3),
  fnv: toIgnoredRecordsSet(GAME_SUBRECORDS_CONFIG_BY_GAME.fnv),
  sse: toIgnoredRecordsSet(GAME_SUBRECORDS_CONFIG_BY_GAME.sse),
  sle: toIgnoredRecordsSet(GAME_SUBRECORDS_CONFIG_BY_GAME.sle),
};

/**
 * Backward-compatible alias - points to the FO4 table.
 * @deprecated Use `getTranslatableSubrecords(game)` instead.
 */
export const TRANSLATABLE_SUBRECORDS = FO4_TRANSLATABLE_SUBRECORDS;

/**
 * Return the translatable-subrecords map for the given game.
 */
export const getTranslatableSubrecords = (game: GameType): Record<string, Set<string>> => {
  return TRANSLATABLE_SUBRECORDS_BY_GAME[game];
};

/**
 * Returns true if this subrecord/record combination is translatable for the given game.
 */
export const isTranslatableSubrecord = (
  recSig: string,
  subSig: string,
  game: GameType,
): boolean => getTranslatableSubrecords(game)[recSig]?.has(subSig) ?? false;

/**
 * Returns true when the record is explicitly treated as ignored for the game.
 */
export const isIgnoredRecord = (recSig: string, game: GameType): boolean => {
  return IGNORED_RECORDS_BY_GAME[game]?.has(recSig) ?? false;
};
