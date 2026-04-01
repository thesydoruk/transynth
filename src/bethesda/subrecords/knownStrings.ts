import type { GameType } from '../../types';
import fo4ConfigJson from './fo4.json' with { type: 'json' };
import fo76ConfigJson from './fo76.json' with { type: 'json' };
import fo3ConfigJson from './fo3.json' with { type: 'json' };
import fnvConfigJson from './fnv.json' with { type: 'json' };
import obConfigJson from './ob.json' with { type: 'json' };
import mwConfigJson from './mw.json' with { type: 'json' };
import sseConfigJson from './sse.json' with { type: 'json' };
import sleConfigJson from './sle.json' with { type: 'json' };

type SubrecordToggleMap = Record<string, boolean>;

interface RecordToggleConfig {
  read: boolean;
  subrecords: SubrecordToggleMap;
}

/** Full subrecord configuration for a single game. */
export interface GameSubrecordsConfig {
  game: GameType;
  records: Record<string, RecordToggleConfig>;
}

export const GAME_SUBRECORDS_CONFIG_BY_GAME: Record<GameType, GameSubrecordsConfig> = {
  fo4: fo4ConfigJson as GameSubrecordsConfig,
  fo76: fo76ConfigJson as GameSubrecordsConfig,
  fo3: fo3ConfigJson as GameSubrecordsConfig,
  fnv: fnvConfigJson as GameSubrecordsConfig,
  ob: obConfigJson as GameSubrecordsConfig,
  mw: mwConfigJson as GameSubrecordsConfig,
  sse: sseConfigJson as GameSubrecordsConfig,
  sle: sleConfigJson as GameSubrecordsConfig,
};

export const TRANSLATABLE_SUBRECORDS_BY_GAME: Record<GameType, Record<string, Set<string>>> = Object.fromEntries(
  (Object.keys(GAME_SUBRECORDS_CONFIG_BY_GAME) as GameType[]).map((game) => {
    const config = GAME_SUBRECORDS_CONFIG_BY_GAME[game];
    const recordMap = Object.fromEntries(
      Object.entries(config.records).map(([record, toggleConfig]) => [
        record,
        new Set(
          Object.entries(toggleConfig.subrecords)
            .filter(([, enabled]) => enabled)
            .map(([subrecord]) => subrecord),
        ),
      ]),
    ) as Record<string, Set<string>>;
    return [game, recordMap];
  }),
) as Record<GameType, Record<string, Set<string>>>;

export const IGNORED_RECORDS_BY_GAME: Record<GameType, ReadonlySet<string>> = Object.fromEntries(
  (Object.keys(GAME_SUBRECORDS_CONFIG_BY_GAME) as GameType[]).map((game) => {
    const config = GAME_SUBRECORDS_CONFIG_BY_GAME[game];
    const ignored = new Set(
      Object.entries(config.records)
        .filter(([, toggleConfig]) => !toggleConfig.read)
        .map(([record]) => record),
    );
    return [game, ignored as ReadonlySet<string>];
  }),
) as Record<GameType, ReadonlySet<string>>;

export const FO4_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fo4;
export const FO76_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fo76;
export const SSE_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.sse;
export const FO3_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fo3;
export const FNV_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fnv;

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
 * Returns true when the record is explicitly treated as ignored for the game.
 */
export const isIgnoredRecord = (recSig: string, game: GameType): boolean => {
  return IGNORED_RECORDS_BY_GAME[game]?.has(recSig) ?? false;
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
 * Load one game's subrecord configuration from JSON.
 */
export const loadGameSubrecordsConfig = (game: GameType): GameSubrecordsConfig => {
  const parsed = GAME_SUBRECORDS_CONFIG_BY_GAME[game];

  if (parsed.game !== game) {
    throw new Error(`Subrecord config mismatch: expected ${game}, got ${parsed.game}`);
  }

  return parsed;
};
