/**
 * Known translatable subrecords configuration for all supported Bethesda games.
 *
 * Each game ships a JSON config file (e.g. `fo4.json`, `sse.json`) that declares
 * which record types should be read and which subrecords within them contain
 * translatable strings. This module loads all configs at startup, pre-computes
 * lookup tables, and exposes predicate helpers used by the ESP reader to decide
 * whether a given record/subrecord pair should be extracted for translation.
 *
 * JSON files live alongside this module in `src/formats/subrecords/`.
 */
import type { GameType } from '../../types';
import fo4ConfigJson from './fo4.json' with { type: 'json' };
import fo76ConfigJson from './fo76.json' with { type: 'json' };
import fo3ConfigJson from './fo3.json' with { type: 'json' };
import fnvConfigJson from './fnv.json' with { type: 'json' };
import obConfigJson from './ob.json' with { type: 'json' };
import mwConfigJson from './mw.json' with { type: 'json' };
import sseConfigJson from './sse.json' with { type: 'json' };
import sleConfigJson from './sle.json' with { type: 'json' };
import discoConfigJson from './disco.json' with { type: 'json' };

/** Map from subrecord signature to enabled/disabled toggle. */
type SubrecordToggleMap = Record<string, boolean>;

/** Per-record read flag and its subrecord toggles. */
interface RecordToggleConfig {
  read: boolean;
  subrecords: SubrecordToggleMap;
}

/** Full subrecord configuration for a single game. */
export interface GameSubrecordsConfig {
  game: GameType;
  records: Record<string, RecordToggleConfig>;
}

/** Raw parsed JSON configs indexed by game identifier. */
export const GAME_SUBRECORDS_CONFIG_BY_GAME: Record<GameType, GameSubrecordsConfig> = {
  fo4: fo4ConfigJson as GameSubrecordsConfig,
  fo76: fo76ConfigJson as GameSubrecordsConfig,
  fo3: fo3ConfigJson as GameSubrecordsConfig,
  fnv: fnvConfigJson as GameSubrecordsConfig,
  ob: obConfigJson as GameSubrecordsConfig,
  mw: mwConfigJson as GameSubrecordsConfig,
  sse: sseConfigJson as GameSubrecordsConfig,
  sle: sleConfigJson as GameSubrecordsConfig,
  disco: discoConfigJson as GameSubrecordsConfig,
};

/**
 * Pre-computed per-game map of record signature → Set of translatable subrecord signatures.
 *
 * For each game, only subrecords marked `true` in the JSON config are included.
 * Used as the primary lookup table by {@link isTranslatableSubrecord}.
 */
export const TRANSLATABLE_SUBRECORDS_BY_GAME: Record<
  GameType,
  Record<string, Set<string>>
> = Object.fromEntries(
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

/**
 * Pre-computed per-game set of record signatures that should be skipped entirely.
 *
 * A record is ignored when its `read` flag is `false` in the game's JSON config.
 */
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
export const isTranslatableSubrecord = (recSig: string, subSig: string, game: GameType): boolean =>
  getTranslatableSubrecords(game)[recSig]?.has(subSig) ?? false;

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
